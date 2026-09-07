import { describe, expect, it, vi } from "vitest";

import {
  prepareCachedChapterTranslation,
} from "../../src/lib/translation/cached-pipeline.client";
import { TRANSLATION_MODELS } from "../../src/lib/translation/models";
import type {
  TranslationCache,
  TranslationCachePutInput,
} from "../../src/services/translation-cache.client";
import type { ChapterSource } from "../../src/types/source";
import type {
  PartialTranslationCacheRecord,
  StoredTranslationCacheRecord,
  TranslationCacheRecord,
} from "../../src/types/storage";
import type { TranslationParagraph, TranslationProgress } from "../../src/types/translation";

const chapter: ChapterSource = {
  kind: "chapter",
  sourceUrl: "https://www.69shuba.com/txt/48273/32028706",
  canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
  siteId: "69shuba",
  chapterTitle: "第一章",
  paragraphs: [
    { id: "p-1", text: "一" },
    { id: "p-2", text: "二" },
    { id: "p-3", text: "三" },
  ],
  navigation: {},
  contentHash: "a".repeat(64),
  fetchedAt: "2026-09-04T00:00:00.000Z",
};

function translations(paragraphs: TranslationParagraph[]) {
  return paragraphs.map(({ id }) => ({ id, text: `${id}-ko` }));
}

function record(cacheKey: string, overrides: Partial<TranslationCacheRecord> = {}): TranslationCacheRecord {
  return {
    cacheKey,
    canonicalUrl: chapter.canonicalUrl,
    contentHash: chapter.contentHash,
    modelId: TRANSLATION_MODELS.fast.modelId,
    targetLanguage: "ko",
    basePromptVersion: "v1",
    userPromptHash: "b".repeat(64),
    translatedParagraphs: translations(chapter.paragraphs),
    createdAt: "2026-09-04T00:00:00.000Z",
    accessedAt: "2026-09-04T00:00:00.000Z",
    byteSize: 1,
    ...overrides,
  };
}

function partialRecord(
  cacheKey: string,
  overrides: Partial<PartialTranslationCacheRecord> = {},
): PartialTranslationCacheRecord {
  return {
    cacheKey,
    canonicalUrl: chapter.canonicalUrl,
    contentHash: chapter.contentHash,
    modelId: TRANSLATION_MODELS.fast.modelId,
    targetLanguage: "ko",
    basePromptVersion: "v1",
    userPromptHash: "b".repeat(64),
    kind: "partial",
    progressStatus: "partial_failure",
    translatedParagraphs: [{ id: "p-1", text: "p-1-ko" }],
    totalParagraphs: 3,
    unfinishedParagraphIds: ["p-2", "p-3"],
    failedParagraphIds: ["p-2"],
    createdAt: "2026-09-04T00:00:00.000Z",
    accessedAt: "2026-09-04T00:00:00.000Z",
    byteSize: 1,
    ...overrides,
  };
}

function cacheDouble() {
  const records = new Map<string, StoredTranslationCacheRecord>();
  const cache: TranslationCache = {
    get: vi.fn(async (key) => records.get(key)),
    put: vi.fn(async (input: TranslationCachePutInput) => {
      const metadata = {
        canonicalUrl: input.canonicalUrl,
        contentHash: input.contentHash,
        modelId: input.modelId,
        targetLanguage: input.targetLanguage,
        basePromptVersion: input.basePromptVersion,
        userPromptHash: input.userPromptHash,
        translatedParagraphs: input.progress.translations,
      };
      const stored = input.progress.status === "complete"
        ? record(input.cacheKey, { ...metadata, kind: "complete" })
        : partialRecord(input.cacheKey, {
          ...metadata,
          progressStatus: input.progress.status,
          totalParagraphs: input.progress.totalParagraphs,
          unfinishedParagraphIds: input.progress.unfinishedParagraphIds ?? [],
          failedParagraphIds: input.progress.failedParagraphIds ?? [],
        });
      records.set(input.cacheKey, stored);
      return { ok: true as const, record: stored };
    }),
    delete: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  return { cache, records };
}

const pipelineDependencies = {
  characterBudget: 1,
  concurrency: 1,
  sleep: vi.fn(async () => {}),
  jitter: () => 0,
};

describe("cached translation pipeline", () => {
  it("loads only a complete cached translation without preparing a Gemini request", async () => {
    const { cache, records } = cacheDouble();
    const translate = vi.fn();
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "이름은 음역한다." },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );
    records.set(task.cacheKey, record(task.cacheKey));

    const cached = await task.getCached();

    expect(cached).toMatchObject({ cache: "hit", progress: { status: "complete" } });
    expect(cached?.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(translate).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("returns a cache hit in source order without requiring or calling Gemini", async () => {
    const { cache, records } = cacheDouble();
    const translate = vi.fn();
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "이름은 음역한다." },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );
    records.set(task.cacheKey, record(task.cacheKey, {
      translatedParagraphs: [
        { id: "p-3", text: "p-3-ko" },
        { id: "p-1", text: "p-1-ko" },
        { id: "p-2", text: "p-2-ko" },
      ],
    }));
    const events: unknown[] = [];

    const result = await task.execute({ onProgress: (event) => events.push(event) });

    expect(result).toMatchObject({ cache: "hit", persistence: { status: "not_attempted" } });
    expect(result.progress).toMatchObject({ status: "complete", completedParagraphs: 3 });
    expect(result.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(events).toEqual([result.progress]);
    expect(translate).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("restores a partial record first and requests only missing paragraph IDs", async () => {
    const { cache, records } = cacheDouble();
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      translations(chunk.paragraphs),
    );
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );
    records.set(task.cacheKey, partialRecord(task.cacheKey, {
      translatedParagraphs: [
        { id: "p-3", text: "p-3-ko" },
        { id: "p-1", text: "p-1-ko" },
      ],
      unfinishedParagraphIds: ["p-2"],
      failedParagraphIds: ["p-2"],
    }));
    const events: TranslationProgress[] = [];

    expect(await task.getCached()).toBeUndefined();
    const result = await task.execute({
      apiKey: "test-key",
      onProgress: (progress) => events.push(progress),
    });

    expect(result).toMatchObject({ cache: "miss", persistence: { status: "saved" } });
    expect(events[0]).toMatchObject({
      status: "translating",
      translations: [{ id: "p-1" }, { id: "p-3" }],
      unfinishedParagraphIds: ["p-2"],
    });
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[0].chunk.paragraphs.map(({ id }) => id)).toEqual(["p-2"]);
    expect(result.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(records.get(task.cacheKey)).toMatchObject({ kind: "complete" });
  });

  it("forwards miss progress and stores only a complete, exact result", async () => {
    const { cache } = cacheDouble();
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      translations(chunk.paragraphs),
    );
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "말투 유지" },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );
    const events: unknown[] = [];

    const result = await task.execute({
      apiKey: "invocation-only-secret",
      onProgress: (event) => events.push(event),
    });

    expect(result).toMatchObject({ cache: "miss", persistence: { status: "saved" } });
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ status: "translating", completedParagraphs: 1 });
    expect(cache.put).toHaveBeenCalledWith(expect.objectContaining({
      cacheKey: task.cacheKey,
      canonicalUrl: chapter.canonicalUrl,
      contentHash: chapter.contentHash,
      modelId: TRANSLATION_MODELS.fast.modelId,
      targetLanguage: "ko",
      progress: result.progress,
    }));
    const serialized = JSON.stringify({ task, events, result, put: vi.mocked(cache.put).mock.calls });
    expect(serialized).not.toContain("invocation-only-secret");
    expect(serialized).not.toContain("말투 유지");
    expect(serialized).not.toContain("一");
  });

  it.each([
    ["content", { chapter: { ...chapter, contentHash: "c".repeat(64) }, mode: "fast" as const, userPrompt: "" }],
    ["model", { chapter, mode: "quality" as const, userPrompt: "" }],
    ["prompt", { chapter, mode: "fast" as const, userPrompt: "다른 지시" }],
  ])("treats changed %s as a cache miss", async (_name, changed) => {
    const { cache, records } = cacheDouble();
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      translations(chunk.paragraphs),
    );
    const base = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );
    records.set(base.cacheKey, record(base.cacheKey));
    const changedTask = await prepareCachedChapterTranslation(changed, {
      cache,
      pipeline: { ...pipelineDependencies, translate },
    });

    const result = await changedTask.execute({ apiKey: "test-key" });

    expect(changedTask.cacheKey).not.toBe(base.cacheKey);
    expect(result.cache).toBe("miss");
    expect(translate).toHaveBeenCalled();
  });

  it("flushes partial and cancelled paragraphs to resumable records", async () => {
    const { cache, records } = cacheDouble();
    const partialTask = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      {
        cache,
        pipeline: {
          ...pipelineDependencies,
          maxRetries: 0,
          translate: vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
            if (chunk.chunkId === "chunk-1") throw new Error("private raw response");
            return translations(chunk.paragraphs);
          }),
        },
      },
    );
    const partial = await partialTask.execute({ apiKey: "test-key" });

    expect(partial).toMatchObject({
      cache: "miss",
      persistence: { status: "saved" },
      progress: { status: "partial_failure" },
    });
    expect(partial.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-3"]);
    expect(vi.mocked(cache.put).mock.lastCall?.[0].progress).toMatchObject({
      status: "partial_failure",
      unfinishedParagraphIds: ["p-2"],
      failedParagraphIds: ["p-2"],
    });
    vi.mocked(cache.put).mockClear();
    records.clear();

    const controller = new AbortController();
    const cancelledTask = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      {
        cache,
        pipeline: {
          ...pipelineDependencies,
          translate: vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
            if (chunk.chunkId === "chunk-0") return translations(chunk.paragraphs);
            controller.abort();
            throw new DOMException("Aborted", "AbortError");
          }),
        },
      },
    );
    const cancelled = await cancelledTask.execute({ apiKey: "test-key", signal: controller.signal });

    expect(cancelled).toMatchObject({ persistence: { status: "saved" }, progress: { status: "cancelled" } });
    expect(cancelled.progress.translations).toEqual([{ id: "p-1", text: "p-1-ko" }]);
    expect(vi.mocked(cache.put).mock.lastCall?.[0].progress).toMatchObject({
      status: "cancelled",
      unfinishedParagraphIds: ["p-2", "p-3"],
    });
  });

  it("keeps a successful translation when persistence safely fails", async () => {
    const { cache } = cacheDouble();
    vi.mocked(cache.put).mockResolvedValue({
      ok: false,
      error: { code: "STORAGE_FULL", message: "브라우저 저장 공간이 부족합니다.", retryable: true },
    });
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      {
        cache,
        pipeline: {
          ...pipelineDependencies,
          translate: vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
            translations(chunk.paragraphs),
          ),
        },
      },
    );

    const result = await task.execute({ apiKey: "test-key" });

    expect(result.progress.status).toBe("complete");
    expect(result.progress.translations).toHaveLength(3);
    expect(result.persistence).toEqual({
      status: "failed",
      error: { code: "STORAGE_FULL", message: "브라우저 저장 공간이 부족합니다.", retryable: true },
    });
  });

  it("bypasses an existing hit and replaces the same key after forced retranslation", async () => {
    const { cache, records } = cacheDouble();
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      chunk.paragraphs.map(({ id }) => ({ id, text: `${id}-fresh` })),
    );
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );
    records.set(task.cacheKey, record(task.cacheKey));

    const result = await task.execute({ apiKey: "test-key", forceRetranslate: true });

    expect(result).toMatchObject({ cache: "bypassed", persistence: { status: "saved" } });
    expect(cache.get).not.toHaveBeenCalled();
    expect(translate).toHaveBeenCalledTimes(3);
    expect(cache.put).toHaveBeenCalledWith(expect.objectContaining({ cacheKey: task.cacheKey }));
    expect(records.get(task.cacheKey)?.translatedParagraphs[0]?.text).toBe("p-1-fresh");
  });

  it("retries only failed chunks, retaining prior successes in progress until the merged result is cached", async () => {
    const { cache } = cacheDouble();
    const translate = vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
      if (chunk.chunkId === "chunk-1") throw new Error("temporary failure");
      return translations(chunk.paragraphs);
    });
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, maxRetries: 0, translate } },
    );
    const first = await task.execute({ apiKey: "test-key" });
    const retryEvents: TranslationProgress[] = [];

    vi.mocked(cache.put).mockClear();
    vi.mocked(translate).mockImplementation(async ({ chunk }) => translations(chunk.paragraphs));
    const retried = await task.execute({
      apiKey: "test-key",
      retryFailed: {
        failedChunkIds: first.progress.failedChunkIds,
        successfulTranslations: first.progress.translations,
      },
      onProgress: (progress) => retryEvents.push(progress),
    });

    expect(first.progress).toMatchObject({ status: "partial_failure", failedChunkIds: ["chunk-1"] });
    expect(translate.mock.calls.slice(3).map(([call]) => call.chunk.chunkId)).toEqual(["chunk-1"]);
    expect(retryEvents[0]).toMatchObject({
      status: "translating",
      completedParagraphs: 2,
      translations: [{ id: "p-1" }, { id: "p-3" }],
    });
    expect(retried).toMatchObject({
      cache: "miss",
      persistence: { status: "saved" },
      progress: { status: "complete", failedChunkIds: [] },
    });
    expect(retried.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("retains streamed successes from inside a failed chunk during an explicit retry", async () => {
    const { cache } = cacheDouble();
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      translations(chunk.paragraphs),
    );
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, characterBudget: 10, translate } },
    );

    const result = await task.execute({
      apiKey: "test-key",
      retryFailed: {
        failedChunkIds: ["chunk-0"],
        successfulTranslations: [{ id: "p-1", text: "p-1-ko" }],
      },
    });

    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[0].chunk.paragraphs.map(({ id }) => id)).toEqual(["p-2", "p-3"]);
    expect(result.progress.status).toBe("complete");
    expect(result.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
  });

  it("retains seeded successes and does not cache when a failed chunk retry fails again", async () => {
    const { cache } = cacheDouble();
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      {
        cache,
        pipeline: {
          ...pipelineDependencies,
          maxRetries: 0,
          translate: vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
            if (chunk.chunkId === "chunk-1") throw new Error("still failing");
            return translations(chunk.paragraphs);
          }),
        },
      },
    );
    const first = await task.execute({ apiKey: "test-key" });
    vi.mocked(cache.put).mockClear();

    const retried = await task.execute({
      apiKey: "test-key",
      retryFailed: {
        failedChunkIds: ["chunk-1"],
        successfulTranslations: first.progress.translations,
      },
    });

    expect(retried.progress).toMatchObject({
      status: "partial_failure",
      failedChunkIds: ["chunk-1"],
      translations: [{ id: "p-1" }, { id: "p-3" }],
    });
    expect(retried.persistence).toEqual({ status: "saved" });
    expect(cache.put).toHaveBeenCalledOnce();
    expect(vi.mocked(cache.put).mock.lastCall?.[0].progress).toMatchObject({
      status: "partial_failure",
      unfinishedParagraphIds: ["p-2"],
    });
  });

  it("safely rejects an invalid partial retry without translating or caching", async () => {
    const { cache } = cacheDouble();
    const translate = vi.fn();
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );

    const result = await task.execute({
      apiKey: "test-key",
      retryFailed: {
        failedChunkIds: ["chunk-1", "chunk-1"],
        successfulTranslations: translations(chapter.paragraphs),
      },
    });

    expect(result).toMatchObject({
      progress: { status: "failed" },
      persistence: { status: "not_attempted" },
      errors: [{ code: "TRANSLATION_FAILED" }],
    });
    expect(translate).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown failed chunk", ["chunk-9"], translations(chapter.paragraphs)],
    ["a translation from the failed chunk", ["chunk-1"], translations(chapter.paragraphs)],
    ["an incomplete successful set", ["chunk-1"], [{ id: "p-1", text: "p-1-ko" }]],
  ])("rejects %s without translating or caching", async (_name, failedChunkIds, successfulTranslations) => {
    const { cache } = cacheDouble();
    const translate = vi.fn();
    const task = await prepareCachedChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { cache, pipeline: { ...pipelineDependencies, translate } },
    );

    const result = await task.execute({
      apiKey: "test-key",
      retryFailed: { failedChunkIds, successfulTranslations },
    });

    expect(result.progress.status).toBe("failed");
    expect(translate).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });
});
