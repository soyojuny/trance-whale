import { describe, expect, it, vi } from "vitest";

import { TranslationOutputError } from "../../src/lib/errors";
import { orchestrateTranslation } from "../../src/lib/translation/orchestrator.client";
import { GeminiClientError } from "../../src/services/gemini.client";
import type { TranslationParagraph, TranslationProgress } from "../../src/types/translation";

const paragraphs: TranslationParagraph[] = [
  { id: "p-1", text: "一" },
  { id: "p-2", text: "二" },
  { id: "p-3", text: "三" },
];

function request(overrides: Record<string, unknown> = {}) {
  return {
    paragraphs,
    apiKey: "test-key",
    modelId: "gemini-3.5-flash-lite",
    userPrompt: "",
    characterBudget: 1,
    ...overrides,
  };
}

describe("orchestrateTranslation", () => {
  it("emits completed chunks before the final result and monotonically increases paragraph progress", async () => {
    const events: TranslationProgress[] = [];
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      chunk.paragraphs.map(({ id }) => ({ id, text: `${id}-ko` })),
    );

    const result = await orchestrateTranslation(request({ onProgress: (event: TranslationProgress) => events.push(event) }), {
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });

    expect(events.slice(0, -1).some((event) => event.completedParagraphs < paragraphs.length)).toBe(true);
    expect(events.map((event) => event.completedParagraphs)).toEqual(
      [...events.map((event) => event.completedParagraphs)].sort((a, b) => a - b),
    );
    expect(result).toMatchObject({ status: "complete", completedParagraphs: 3, failedChunkIds: [] });
  });

  it("limits concurrency and sorts final translations in source order", async () => {
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return chunk.paragraphs.map(({ id }) => ({ id, text: `${id}-ko` }));
    });

    const pending = orchestrateTranslation(request(), {
      concurrency: 2,
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]?.();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[0]?.();
    releases[2]?.();

    const result = await pending;
    expect(maximumActive).toBe(2);
    expect(result.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
  });

  it.each([
    new GeminiClientError("QUOTA_EXCEEDED", true),
    new GeminiClientError("TRANSLATION_FAILED", true),
    new TypeError("network failed"),
    new TranslationOutputError("MISSING_ID"),
  ])("retries retryable failures only up to the configured limit", async (error) => {
    const translate = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await orchestrateTranslation(request({ paragraphs: [paragraphs[0]] }), {
      maxRetries: 2,
      translate,
      sleep,
      jitter: () => 7,
    });

    expect(translate).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([257, 507]);
    expect(result.status).toBe("failed");
  });

  it.each([
    new GeminiClientError("INVALID_API_KEY", false),
    new GeminiClientError("MODEL_UNAVAILABLE", false),
    new GeminiClientError("TRANSLATION_BLOCKED", false),
  ])("does not retry permanent Gemini failures", async (error) => {
    const translate = vi.fn().mockRejectedValue(error);
    const result = await orchestrateTranslation(request({ paragraphs: [paragraphs[0]] }), {
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });

    expect(translate).toHaveBeenCalledOnce();
    expect(result.status).toBe("failed");
  });

  it("keeps successful chunks when another chunk permanently fails", async () => {
    const translate = vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
      if (chunk.chunkId === "chunk-1") throw new GeminiClientError("TRANSLATION_BLOCKED", false);
      return chunk.paragraphs.map(({ id }) => ({ id, text: `${id}-ko` }));
    });

    const result = await orchestrateTranslation(request(), {
      concurrency: 1,
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });

    expect(result.status).toBe("partial_failure");
    expect(result.failedChunkIds).toEqual(["chunk-1"]);
    expect(result.translations.map(({ id }) => id)).toEqual(["p-1", "p-3"]);
    expect(translate.mock.calls.filter(([call]) => call.chunk.chunkId === "chunk-0")).toHaveLength(1);
  });

  it("runs only selected failed chunks and rejects translations for preserved chunks", async () => {
    const events: TranslationProgress[] = [];
    const translate = vi.fn(async () => [{ id: "p-1", text: "changed" }]);

    const result = await orchestrateTranslation(request({
      chunkIds: ["chunk-1"],
      initialTranslations: [
        { id: "p-1", text: "하나" },
        { id: "p-3", text: "셋" },
      ],
      onProgress: (event: TranslationProgress) => events.push(event),
    }), {
      concurrency: 1,
      maxRetries: 0,
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });

    expect(translate).toHaveBeenCalledWith(expect.objectContaining({ chunk: expect.objectContaining({ chunkId: "chunk-1" }) }));
    expect(events[0]).toMatchObject({
      status: "translating",
      translations: [{ id: "p-1", text: "하나" }, { id: "p-3", text: "셋" }],
    });
    expect(result).toMatchObject({ status: "partial_failure", failedChunkIds: ["chunk-1"] });
    expect(result.translations).toEqual([{ id: "p-1", text: "하나" }, { id: "p-3", text: "셋" }]);
  });

  it("aborts pending work and reports cancellation while preserving completed translations", async () => {
    const controller = new AbortController();
    const translate = vi.fn(async ({ chunk, signal }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] }; signal: AbortSignal }) => {
      if (chunk.chunkId === "chunk-0") return [{ id: "p-1", text: "하나" }];
      controller.abort();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
      );
      return [];
    });

    const result = await orchestrateTranslation(request({ signal: controller.signal }), {
      concurrency: 1,
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });

    expect(result.status).toBe("cancelled");
    expect(result.translations).toEqual([{ id: "p-1", text: "하나" }]);
    expect(translate).toHaveBeenCalledTimes(2);
  });
});
