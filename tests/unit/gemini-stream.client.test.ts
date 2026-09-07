import { describe, expect, it, vi } from "vitest";

import {
  createTranslationJsonParser,
  geminiTextParts,
  readGeminiSse,
} from "../../src/lib/translation/gemini-stream.client";

const encoder = new TextEncoder();

function streamBytes(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

async function readEvents(chunks: Uint8Array[]) {
  const events: unknown[] = [];
  for await (const event of readGeminiSse(streamBytes(chunks))) events.push(event);
  return events;
}

describe("Gemini SSE decoder", () => {
  it("ignores empty, textless and thought parts while preserving visible text order", () => {
    expect(geminiTextParts({ candidates: [{ content: { parts: [
      { thoughtSignature: "" }, {}, { text: "" },
      { text: "hidden fixture", thought: true },
      { text: "first" }, { text: "second" },
    ] } }, { content: { parts: [{ text: "other candidate" }] } }] })).toEqual(["first", "second"]);
    expect(geminiTextParts({ usageMetadata: {} })).toEqual([]);
    expect(() => geminiTextParts({ candidates: "invalid fixture" })).toThrow(
      expect.objectContaining({ reason: "INVALID_SCHEMA" }),
    );
  });
  it("restores Unicode across every byte boundary and dispatches each event once", async () => {
    const envelope = { candidates: [{ content: { parts: [{ text: "🐋한字" }] } }] };
    const bytes = encoder.encode(`data: ${JSON.stringify(envelope)}\r\n\r\n`);
    for (let boundary = 1; boundary < bytes.length; boundary += 1) {
      expect(await readEvents([bytes.slice(0, boundary), bytes.slice(boundary)])).toEqual([envelope]);
    }
    expect(await readEvents(Array.from(bytes, (byte) => Uint8Array.of(byte)))).toEqual([envelope]);
  });

  it("supports comments, multiple data lines, all line endings and metadata-only events", async () => {
    expect(await readEvents([encoder.encode(
      ': comment\nevent: message\ndata: {"candidates":\ndata: []}\n\n' +
      'data: {"usageMetadata":{"totalTokenCount":1}}\r\r' +
      'data: {"candidates":[{"content":{"parts":[{"thoughtSignature":""},{}]}}]}\r\n\r\n',
    )])).toEqual([
      { candidates: [] },
      { usageMetadata: { totalTokenCount: 1 } },
      { candidates: [{ content: { parts: [{ thoughtSignature: "" }, {}] } }] },
    ]);
  });

  it("discards unfinished events when the connection ends", async () => {
    expect(await readEvents([encoder.encode('data: {"secret":"fixture"}')])).toEqual([]);
    expect(await readEvents([encoder.encode('data: {"secret":"fixture"}\n')])).toEqual([]);
    expect(await readEvents([encoder.encode('data: {"secret":')])).toEqual([]);
  });

  it("replaces malformed event errors with a safe contract error", async () => {
    const error = await readEvents([encoder.encode('data: secret-fixture\n\n')]).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "TRANSLATION_FAILED", reason: "MALFORMED_JSON" });
    expect(String(error)).not.toContain("secret-fixture");
    expect(JSON.stringify(error)).not.toContain("secret-fixture");
  });

  it("keeps already emitted candidates on connection failure and sanitizes the read error", async () => {
    let reads = 0;
    const input = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (reads++ === 0) {
          const text = '{"translations":[{"id":"p1","text":"fixture"},';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`));
        } else controller.error(new TypeError("secret-fixture"));
      },
    });
    const emitted: unknown[] = [];
    const parser = createTranslationJsonParser();
    let error: unknown;
    try {
      for await (const envelope of readGeminiSse(input)) {
        for (const text of geminiTextParts(envelope)) emitted.push(...parser.push(text));
      }
    } catch (caught) {
      error = caught;
    }
    expect(emitted).toEqual([{ id: "p1", text: "fixture" }]);
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain("secret-fixture");
    expect(input.locked).toBe(false);
  });

  it("combines text from multiple events without replaying completed objects", async () => {
    const events = [
      { candidates: [{ content: { parts: [{ text: '{"translations":[{"id":"p1","text":"fix' }] } }] },
      { candidates: [{ content: { parts: [{ thoughtSignature: "" }, { text: "" }] } }] },
      { candidates: [{ content: { parts: [{ text: 'ture"}' }, { text: ',{"id":"p2","text":"pending' }] } }] },
    ];
    const bytes = encoder.encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
    const parser = createTranslationJsonParser();
    const emitted: unknown[] = [];
    for await (const envelope of readGeminiSse(streamBytes(Array.from(bytes, (byte) => Uint8Array.of(byte))))) {
      for (const text of geminiTextParts(envelope)) emitted.push(...parser.push(text));
    }
    expect(emitted).toEqual([{ id: "p1", text: "fixture" }]);
    expect(() => parser.finish()).toThrow(expect.objectContaining({ reason: "MALFORMED_JSON" }));
  });
});

describe("incremental translations JSON parser", () => {
  const candidates = [
    { id: "p2", text: '🐋 \\ \" {[ ]}', extra: { nested: [1, { flag: true }] } },
    { id: "p1", text: "fixture" },
  ];
  const json = JSON.stringify({ translations: candidates });

  it("emits complete objects exactly once at every text boundary without validating their IDs", () => {
    for (let boundary = 0; boundary <= json.length; boundary += 1) {
      const parser = createTranslationJsonParser();
      const emitted = [...parser.push(json.slice(0, boundary)), ...parser.push(""), ...parser.push(json.slice(boundary))];
      expect(emitted).toEqual(candidates);
      expect(parser.push("")).toEqual([]);
      expect(parser.finish()).toBe(json);
    }
  });

  it("emits the first completed object before the second or final wrapper arrives", () => {
    const parser = createTranslationJsonParser();
    expect(parser.push(`{"translations":[${JSON.stringify(candidates[0])}`)).toEqual([candidates[0]]);
    expect(parser.push(',{"id":"p1","text":"fixt')).toEqual([]);
    expect(() => parser.finish()).toThrow(expect.objectContaining({ reason: "MALFORMED_JSON" }));
  });

  it("handles one character at a time including whitespace and escape sequences", () => {
    const parser = createTranslationJsonParser();
    const emitted = Array.from(` \n${json}\t`, (character) => parser.push(character)).flat();
    expect(emitted).toEqual(candidates);
    expect(parser.finish()).toBe(` \n${json}\t`);
  });

  it.each([
    '{"translations":[{"id":"p1","text":"secret-fixture"',
    '{"translations":[{"id":"p1","text":"secret-fixture",}]}',
    '{"translations":[{"id":"p1","text":"secret-fixture"} garbage]}',
  ])("rejects incomplete or malformed JSON without exposing input", (input) => {
    const parser = createTranslationJsonParser();
    let error: unknown;
    try {
      parser.push(input);
      parser.finish();
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "TRANSLATION_FAILED", reason: "MALFORMED_JSON" });
    expect(String(error)).not.toContain("secret-fixture");
    expect(JSON.stringify(error)).not.toContain("secret-fixture");
  });

  it("does not mistake a nested or quoted translations key for the root array", () => {
    const parser = createTranslationJsonParser();
    expect(parser.push('{"other":{"translations":[{"id":"p1","text":"fixture"}]}}')).toEqual([]);
  });

  it("imports without server build variables in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PWA_BUILD_ID", undefined);
    try {
      await expect(import("../../src/lib/translation/gemini-stream.client")).resolves.toBeDefined();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
