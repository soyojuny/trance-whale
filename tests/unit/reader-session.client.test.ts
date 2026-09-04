import { describe, expect, it, vi } from "vitest";

import {
  createReaderSessionController,
  readerSessionReducer,
  type ReaderSessionState,
} from "../../src/lib/reader/session.client";
import type {
  CachedChapterTranslationResult,
  PreparedCachedChapterTranslation,
} from "../../src/lib/translation/cached-pipeline.client";
import type { ChapterSource } from "../../src/types/source";
import type { TranslationProgress } from "../../src/types/translation";

const chapter = (id: string): ChapterSource => ({
  kind: "chapter",
  sourceUrl: `https://www.69shuba.com/txt/1/${id}`,
  canonicalUrl: `https://www.69shuba.com/txt/1/${id}`,
  siteId: "69shuba",
  chapterId: id,
  chapterTitle: `Chapter ${id}`,
  paragraphs: [
    { id: "p1", text: "one" },
    { id: "p2", text: "two" },
    { id: "p3", text: "three" },
  ],
  navigation: {},
  contentHash: id.padEnd(64, "0"),
  fetchedAt: "2026-09-04T00:00:00.000Z",
});

const progress = (
  status: TranslationProgress["status"],
  translations: TranslationProgress["translations"],
  failedChunkIds: string[] = [],
): TranslationProgress => ({
  status,
  completedParagraphs: translations.length,
  totalParagraphs: 3,
  translations,
  failedChunkIds,
});

const result = (
  value: TranslationProgress,
  cache: CachedChapterTranslationResult["cache"] = "miss",
): CachedChapterTranslationResult => ({
  progress: value,
  errors: value.failedChunkIds.map((chunkId) => ({
    chunkId,
    code: "TRANSLATION_FAILED",
    message: "번역을 완료할 수 없습니다.",
    retryable: true,
  })),
  cache,
  persistence: { status: "not_attempted" },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(execute: PreparedCachedChapterTranslation["execute"]) {
  const states: ReaderSessionState[] = [];
  const sourceClient = {
    fetchChapter: vi.fn(async (url: string) => chapter(url.endsWith("2") ? "2" : "1")),
    fetchCatalog: vi.fn(),
  };
  const preparePipeline = vi.fn(async () => ({ cacheKey: "cache-key", execute }));
  const controller = createReaderSessionController({
    sourceClient,
    preparePipeline,
    loadTranslationSettings: () => ({
      apiKey: "secret-key",
      userPrompt: "secret prompt",
      translationMode: "fast",
    }),
    onStateChange: (state) => states.push(state),
  });
  return { controller, sourceClient, preparePipeline, states };
}

describe("reader session reducer", () => {
  it("orders progress translations by the source paragraph order", () => {
    const source = chapter("1");
    const initial: ReaderSessionState = {
      status: "translating",
      chapter: source,
      translations: [],
      completedParagraphs: 0,
      totalParagraphs: 3,
      failedChunkIds: [],
    };

    const state = readerSessionReducer(initial, {
      type: "translation_progress",
      progress: progress("translating", [
        { id: "p3", text: "셋" },
        { id: "p1", text: "하나" },
      ]),
    });

    expect(state.status).toBe("translating");
    if (state.status !== "translating") throw new Error("unexpected state");
    expect(state.translations.map(({ id }) => id)).toEqual(["p1", "p3"]);
  });
});

describe("reader session controller", () => {
  it.each(["hit", "miss"] as const)("opens a chapter through the state sequence on cache %s", async (cache) => {
    const execute = vi.fn(async ({ onProgress }) => {
      const complete = progress("complete", [
        { id: "p1", text: "하나" },
        { id: "p2", text: "둘" },
        { id: "p3", text: "셋" },
      ]);
      onProgress?.(complete);
      return result(complete, cache);
    });
    const { controller, states } = setup(execute);

    await controller.openChapter("https://www.69shuba.com/txt/1/1");

    expect(states.map(({ status }) => status)).toEqual([
      "fetching_source",
      "parsing_response",
      "checking_cache",
      "complete",
    ]);
    expect(controller.getState().status).toBe("complete");
  });

  it("publishes progressive translations in source order before completion", async () => {
    const execute = vi.fn(async ({ onProgress }) => {
      onProgress?.(progress("translating", [{ id: "p2", text: "둘" }]));
      onProgress?.(progress("translating", [
        { id: "p2", text: "둘" },
        { id: "p1", text: "하나" },
      ]));
      const complete = progress("complete", [
        { id: "p2", text: "둘" },
        { id: "p1", text: "하나" },
        { id: "p3", text: "셋" },
      ]);
      onProgress?.(complete);
      return result(complete);
    });
    const { controller, states } = setup(execute);

    await controller.openChapter("https://www.69shuba.com/txt/1/1");

    const translating = states.filter((state) => state.status === "translating");
    expect(translating.map((state) => state.translations.map(({ id }) => id))).toEqual([
      ["p2"],
      ["p1", "p2"],
    ]);
  });

  it("cancels the active source and ignores late results after a fast chapter switch", async () => {
    const first = deferred<ChapterSource>();
    const sourceClient = {
      fetchChapter: vi.fn((url: string, signal: AbortSignal) => {
        if (url.endsWith("1")) {
          signal.addEventListener("abort", () => undefined);
          return first.promise;
        }
        return Promise.resolve(chapter("2"));
      }),
      fetchCatalog: vi.fn(),
    };
    const complete = progress("complete", [
      { id: "p1", text: "하나" },
      { id: "p2", text: "둘" },
      { id: "p3", text: "셋" },
    ]);
    const controller = createReaderSessionController({
      sourceClient,
      preparePipeline: async () => ({ cacheKey: "key", execute: async () => result(complete) }),
      loadTranslationSettings: () => ({ apiKey: "secret", userPrompt: "", translationMode: "fast" }),
    });

    const oldOpen = controller.openChapter("https://www.69shuba.com/txt/1/1");
    const newOpen = controller.openChapter("https://www.69shuba.com/txt/1/2");
    first.resolve(chapter("1"));
    await Promise.all([oldOpen, newOpen]);

    expect(sourceClient.fetchChapter.mock.calls[0]?.[1].aborted).toBe(true);
    const state = controller.getState();
    expect(state.status).toBe("complete");
    expect("chapter" in state && state.chapter.chapterId).toBe("2");
  });

  it("preserves successful paragraphs and retries a partial failure", async () => {
    const partial = progress("partial_failure", [{ id: "p1", text: "하나" }], ["chunk-2"]);
    const complete = progress("complete", [
      { id: "p1", text: "하나" },
      { id: "p2", text: "둘" },
      { id: "p3", text: "셋" },
    ]);
    const execute = vi.fn()
      .mockResolvedValueOnce(result(partial))
      .mockImplementationOnce(async ({ onProgress }) => {
        onProgress?.(complete);
        return result(complete, "bypassed");
      });
    const { controller } = setup(execute);

    await controller.openChapter("https://www.69shuba.com/txt/1/1");
    expect(controller.getState()).toMatchObject({
      status: "partial_failure",
      translations: [{ id: "p1", text: "하나" }],
      failedChunkIds: ["chunk-2"],
    });

    await controller.retryFailedTranslation();

    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ forceRetranslate: true }));
    expect(controller.getState().status).toBe("complete");
  });

  it("separates source reload from cache-bypassed retranslation", async () => {
    const complete = progress("complete", [
      { id: "p1", text: "하나" },
      { id: "p2", text: "둘" },
      { id: "p3", text: "셋" },
    ]);
    const execute = vi.fn(async () => result(complete));
    const { controller, sourceClient, preparePipeline } = setup(execute);

    await controller.openChapter("https://www.69shuba.com/txt/1/1");
    await controller.forceRetranslate();
    expect(sourceClient.fetchChapter).toHaveBeenCalledTimes(1);
    expect(preparePipeline).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ forceRetranslate: true }));

    await controller.forceReload();
    expect(sourceClient.fetchChapter).toHaveBeenCalledTimes(2);
    expect(preparePipeline).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ forceRetranslate: false }));
  });

  it("keeps only a safe public error in failed state", async () => {
    const secret = "AIza-secret-value";
    const { controller } = setup(async () => {
      throw new Error(`${secret} raw upstream body`);
    });

    await controller.openChapter("https://www.69shuba.com/txt/1/1");

    expect(controller.getState()).toEqual({
      status: "failed",
      error: {
        code: "TRANSLATION_FAILED",
        message: "번역을 완료할 수 없습니다.",
        retryable: true,
      },
    });
    expect(JSON.stringify(controller.getState())).not.toContain(secret);
  });
});
