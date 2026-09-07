import { describe, expect, it, vi } from "vitest";

import { TranslationOutputError } from "../../src/lib/errors";
import type { TranslationDiagnosticEvent } from "../../src/lib/translation/diagnostics.client";
import { orchestrateTranslation, type Translate } from "../../src/lib/translation/orchestrator.client";
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
  it.each([
    { overrides: {}, expected: [true, false, false] },
    { overrides: { initialTranslations: [paragraphs[0]] }, expected: [false, false] },
    { overrides: { initialTranslations: [paragraphs[1]] }, expected: [true, false] },
    { overrides: { chunkIds: ["chunk-2"] }, expected: [false] },
    { overrides: { characterBudget: 10 }, expected: [true] },
  ])("identifies the chapter opening from source paragraphs: $overrides", async ({ overrides, expected }) => {
    const translate = vi.fn<Translate>(async ({ chunk }) => chunk.paragraphs);
    await orchestrateTranslation(request(overrides), { translate });
    expect(translate.mock.calls.map(([call]) => call.isChapterStart)).toEqual(expected);
  });

  it("requests chunks sequentially by default and forwards a paragraph before chunk completion", async () => {
    const events: TranslationProgress[] = [];
    const releases: Array<() => void> = [];
    const translate = vi.fn<Translate>(async ({ chunk, onProgress }) => {
      const translated = chunk.paragraphs.map(({ id }) => ({ id, text: `${id}-ko` }));
      onProgress?.(translated[0]);
      await new Promise<void>((resolve) => releases.push(resolve));
      return translated;
    });
    const pending = orchestrateTranslation(request({ onProgress: (event: TranslationProgress) => events.push(event) }), { translate });
    await vi.waitFor(() => expect(events[0]).toMatchObject({ completedParagraphs: 1, unfinishedParagraphIds: ["p-2", "p-3"] }));
    expect(translate).toHaveBeenCalledTimes(1);
    releases[0]();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(2));
    releases[1]();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledTimes(3));
    releases[2]();
    expect(await pending).toMatchObject({ status: "complete", unfinishedParagraphIds: [], failedParagraphIds: [] });
    expect(events.filter((event) => event.status === "translating").map((event) => event.completedParagraphs)).toEqual([1, 2, 3]);
  });

  it("keeps streamed successes and identifies only unfinished failed paragraphs", async () => {
    const events: TranslationProgress[] = [];
    const diagnostics: TranslationDiagnosticEvent[] = [];
    const translate = vi.fn<Translate>(async ({ chunk, onProgress }) => {
      onProgress?.({ id: chunk.paragraphs[0].id, text: "kept" });
      throw new TranslationOutputError("MISSING_ID");
    });
    const result = await orchestrateTranslation(request({ characterBudget: 10, onProgress: (event: TranslationProgress) => events.push(event) }), {
      translate,
      diagnosticLogger: (event) => diagnostics.push(event),
    });
    expect(result).toMatchObject({
      status: "partial_failure", translations: [{ id: "p-1", text: "kept" }],
      unfinishedParagraphIds: ["p-2", "p-3"], failedParagraphIds: ["p-2", "p-3"], failedChunkIds: ["chunk-0"],
    });
    expect(events[0]).toMatchObject({ completedParagraphs: 1, failedParagraphIds: [] });
    expect(diagnostics.some((event) => event.event === "retry_scheduled")).toBe(false);
  });

  it("keeps a streamed success on cancellation and distinguishes unattempted IDs from failures", async () => {
    const controller = new AbortController();
    const translate = vi.fn<Translate>(async ({ onProgress }) => {
      onProgress?.({ id: "p-1", text: "kept" });
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    const result = await orchestrateTranslation(request({ signal: controller.signal, characterBudget: 2 }), { translate });
    expect(result).toMatchObject({
      status: "cancelled", translations: [{ id: "p-1", text: "kept" }],
      unfinishedParagraphIds: ["p-2", "p-3"], failedParagraphIds: [], failedChunkIds: [],
    });
    expect(translate).toHaveBeenCalledTimes(1);
  });

  it("resumes only discontinuous missing paragraphs in source order", async () => {
    const events: TranslationProgress[] = [];
    const translate = vi.fn<Translate>(async ({ chunk }) => chunk.paragraphs.map(({ id }) => ({ id, text: "new" })));
    const result = await orchestrateTranslation(request({
      characterBudget: 10,
      initialTranslations: [{ id: "p-2", text: "saved" }],
      onProgress: (event: TranslationProgress) => events.push(event),
    }), { translate });
    expect(translate.mock.calls[0][0].chunk.paragraphs.map(({ id }) => id)).toEqual(["p-1", "p-3"]);
    expect(events[0]).toMatchObject({ translations: [{ id: "p-2", text: "saved" }], unfinishedParagraphIds: ["p-1", "p-3"] });
    expect(result.translations).toEqual([{ id: "p-1", text: "new" }, { id: "p-2", text: "saved" }, { id: "p-3", text: "new" }]);
  });

  it.each([
    [{ id: "unknown", text: "saved" }],
    [{ id: "p-1", text: "saved" }, { id: "p-1", text: "duplicate" }],
    [{ id: "p-1", text: " " }],
  ])("rejects invalid resume seeds before making a request", async (...initialTranslations) => {
    const translate = vi.fn<Translate>();
    await expect(orchestrateTranslation(request({ initialTranslations }), { translate })).rejects.toBeInstanceOf(TranslationOutputError);
    expect(translate).not.toHaveBeenCalled();
  });

  it("skips translation when every source paragraph is already validated", async () => {
    const translate = vi.fn<Translate>();
    const result = await orchestrateTranslation(request({ initialTranslations: paragraphs }), { translate });
    expect(translate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "complete", completedParagraphs: 3, unfinishedParagraphIds: [] });
  });

  it("retries only remaining paragraphs after a partial network failure", async () => {
    const translate = vi.fn<Translate>()
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress?.({ id: "p-1", text: "kept" });
        throw new TypeError("network");
      })
      .mockImplementationOnce(async ({ chunk }) => chunk.paragraphs.map(({ id }) => ({ id, text: "new" })));
    const result = await orchestrateTranslation(request({ characterBudget: 10 }), { translate, sleep: vi.fn().mockResolvedValue(undefined), jitter: () => 0 });
    expect(translate.mock.calls[1][0].chunk.paragraphs.map(({ id }) => id)).toEqual(["p-2", "p-3"]);
    expect(translate.mock.calls.map(([call]) => call.isChapterStart)).toEqual([true, false]);
    expect(result).toMatchObject({ status: "complete", translations: [{ id: "p-1", text: "kept" }, { id: "p-2", text: "new" }, { id: "p-3", text: "new" }] });
  });

  it("does not accept conflicting final translations after a progress callback", async () => {
    const translate = vi.fn<Translate>(async ({ onProgress }) => {
      onProgress?.({ id: "p-1", text: "kept" });
      return [{ id: "p-1", text: "changed" }];
    });
    const result = await orchestrateTranslation(request({ paragraphs: [paragraphs[0]] }), { translate });
    expect(result).toMatchObject({ status: "partial_failure", translations: [{ id: "p-1", text: "kept" }] });
  });

  it("ignores late callbacks from a failed attempt during retry backoff", async () => {
    let staleProgress: Parameters<Translate>[0]["onProgress"];
    const translate = vi.fn<Translate>()
      .mockImplementationOnce(async ({ onProgress }) => {
        staleProgress = onProgress;
        onProgress?.({ id: "p-1", text: "kept" });
        throw new TypeError("network");
      })
      .mockImplementationOnce(async ({ chunk }) => chunk.paragraphs.map(({ id }) => ({ id, text: "new" })));
    const result = await orchestrateTranslation(request({ characterBudget: 10 }), {
      translate,
      sleep: async () => { staleProgress?.({ id: "p-2", text: "late" }); },
    });
    expect(translate.mock.calls[1][0].chunk.paragraphs.map(({ id }) => id)).toEqual(["p-2", "p-3"]);
    expect(result.translations[1]).toEqual({ id: "p-2", text: "new" });
  });

  it("ignores duplicate identical callbacks without replaying progress", async () => {
    const events: TranslationProgress[] = [];
    const translate = vi.fn<Translate>(async ({ onProgress }) => {
      onProgress?.({ id: "p-1", text: "kept" });
      onProgress?.({ id: "p-1", text: "kept" });
      return [{ id: "p-1", text: "kept" }];
    });
    await orchestrateTranslation(request({ paragraphs: [paragraphs[0]], onProgress: (event: TranslationProgress) => events.push(event) }), { translate });
    expect(events.filter((event) => event.status === "translating")).toHaveLength(1);
  });

  it("imports the orchestrator without server build variables in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PWA_BUILD_ID", undefined);
    try {
      await expect(import("../../src/lib/translation/orchestrator.client")).resolves.toBeDefined();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

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
    new GeminiClientError("TRANSLATION_FAILED", true),
    new TypeError("network failed"),
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

  it("does not automatically retry output-contract failures", async () => {
    const translate = vi.fn().mockRejectedValue(new TranslationOutputError("MISSING_ID"));
    const sleep = vi.fn();
    const diagnostics: TranslationDiagnosticEvent[] = [];

    const result = await orchestrateTranslation(request({ paragraphs: [paragraphs[0]] }), {
      maxRetries: 2,
      translate,
      sleep,
      jitter: () => 0,
      diagnosticLogger: (event) => diagnostics.push(event),
    });

    expect(translate).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "partial_failure", failedChunkIds: ["chunk-0"] });
    expect(diagnostics).toEqual([
      expect.objectContaining({ event: "attempt_started", chunkId: "chunk-0", attempt: 1 }),
      expect.objectContaining({
        event: "attempt_failed",
        chunkId: "chunk-0",
        attempt: 1,
        errorType: "output_contract",
        errorCode: "MISSING_ID",
        retryable: false,
        willRetry: false,
      }),
    ]);
  });

  it("records each automatic retry distinctly", async () => {
    const diagnostics: TranslationDiagnosticEvent[] = [];
    const translate = vi.fn()
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce([{ id: "p-1", text: "하나" }]);

    await expect(orchestrateTranslation(request({ paragraphs: [paragraphs[0]] }), {
      maxRetries: 2,
      translate,
      sleep: vi.fn().mockResolvedValue(undefined),
      jitter: () => 0,
      diagnosticLogger: (event) => diagnostics.push(event),
    })).resolves.toMatchObject({ status: "complete" });

    expect(diagnostics).toEqual([
      expect.objectContaining({ event: "attempt_started", chunkId: "chunk-0", attempt: 1 }),
      expect.objectContaining({
        event: "attempt_failed",
        chunkId: "chunk-0",
        attempt: 1,
        errorType: "network",
        retryable: true,
        willRetry: true,
      }),
      expect.objectContaining({ event: "retry_scheduled", chunkId: "chunk-0", attempt: 1, delayMs: 250 }),
      expect.objectContaining({ event: "attempt_started", chunkId: "chunk-0", attempt: 2 }),
      expect.objectContaining({
        event: "attempt_succeeded",
        chunkId: "chunk-0",
        attempt: 2,
        translationCount: 1,
      }),
    ]);
  });

  it("does not automatically retry Gemini usage exhaustion", async () => {
    const translate = vi.fn().mockRejectedValue(new GeminiClientError("QUOTA_EXCEEDED", true));

    const result = await orchestrateTranslation(request({ paragraphs: [paragraphs[0]] }), {
      translate,
      sleep: vi.fn(),
      jitter: () => 0,
    });

    expect(translate).toHaveBeenCalledOnce();
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
