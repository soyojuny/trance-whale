import { describe, expect, it, vi } from "vitest";

import { TranslationOutputError } from "../../src/lib/errors";
import { TRANSLATION_MODELS } from "../../src/lib/translation/models";
import {
  prepareChapterTranslation,
  type ChapterTranslationProgress,
} from "../../src/lib/translation/pipeline.client";
import { GeminiClientError } from "../../src/services/gemini.client";
import type { ChapterSource } from "../../src/types/source";
import type { TranslationParagraph } from "../../src/types/translation";

const chapter: ChapterSource = {
  kind: "chapter",
  sourceUrl: "https://www.69shuba.com/txt/48273/32028706",
  canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
  siteId: "69shuba",
  bookId: "48273",
  bookTitle: "示例小说",
  chapterId: "32028706",
  chapterNumber: 1,
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

function translated(chunk: { paragraphs: TranslationParagraph[] }) {
  return chunk.paragraphs.map(({ id }) => ({ id, text: `${id}-ko` }));
}

describe("client translation pipeline", () => {
  it("prepares a cache key and completes every chapter paragraph through the existing pipeline", async () => {
    const events: ChapterTranslationProgress[] = [];
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      translated(chunk),
    );
    const task = await prepareChapterTranslation(
      { chapter, mode: "fast", userPrompt: "이름은 음역한다." },
      { translate, characterBudget: 1, concurrency: 1, sleep: vi.fn(async () => {}), jitter: () => 0 },
    );

    const result = await task.execute({
      apiKey: "invocation-only-secret",
      onProgress: (event) => events.push(event),
    });

    expect(task.cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(result.progress.status).toBe("complete");
    expect(result.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-2", "p-3"]);
    expect(events[0]?.translations).toEqual([{ id: "p-1", text: "p-1-ko" }]);
    expect(translate).toHaveBeenCalledTimes(3);
    expect(JSON.stringify({ task, events, result })).not.toContain("invocation-only-secret");
    expect(JSON.stringify(events)).not.toContain("一");
    expect(JSON.stringify(events)).not.toContain("이름은 음역한다.");
  });

  it("resumes from validated paragraph seeds without requesting them again", async () => {
    const events: ChapterTranslationProgress[] = [];
    const translate = vi.fn(async ({ chunk }: { chunk: { paragraphs: TranslationParagraph[] } }) =>
      translated(chunk),
    );
    const task = await prepareChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { translate, characterBudget: 1, concurrency: 1 },
    );

    const result = await task.execute({
      apiKey: "test-key",
      initialTranslations: [
        { id: "p-3", text: "p-3-ko" },
        { id: "p-1", text: "p-1-ko" },
      ],
      onProgress: (progress) => events.push(progress),
    });

    expect(events[0]?.translations.map(({ id }) => id)).toEqual(["p-1", "p-3"]);
    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[0].chunk.paragraphs.map(({ id }) => id)).toEqual(["p-2"]);
    expect(result.progress.status).toBe("complete");
  });

  it("does not retry usage exhaustion or output-contract failures", async () => {
    const attempts = new Map<string, number>();
    const translate = vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
      const attempt = (attempts.get(chunk.chunkId) ?? 0) + 1;
      attempts.set(chunk.chunkId, attempt);
      if (chunk.chunkId === "chunk-0" && attempt === 1) {
        throw new GeminiClientError("QUOTA_EXCEEDED", false);
      }
      if (chunk.chunkId === "chunk-1" && attempt === 1) {
        throw new TranslationOutputError("MISSING_ID");
      }
      return translated(chunk);
    });
    const task = await prepareChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      { translate, characterBudget: 1, concurrency: 1, sleep: vi.fn(async () => {}), jitter: () => 0 },
    );

    const result = await task.execute({ apiKey: "test-key" });

    expect(result.progress).toMatchObject({ status: "partial_failure", failedChunkIds: ["chunk-0", "chunk-1"] });
    expect(result.progress.translations.map(({ id }) => id)).toEqual(["p-3"]);
    expect(attempts).toEqual(new Map([["chunk-0", 1], ["chunk-1", 1], ["chunk-2", 1]]));
    expect(result.errors).toEqual([{
      chunkId: "chunk-0",
      code: "QUOTA_EXCEEDED",
      message: "Gemini API 사용량이 소진되었습니다. 사용량을 확인한 뒤 다시 시도해 주세요.",
      retryable: false,
    }, {
      chunkId: "chunk-1",
      code: "TRANSLATION_FAILED",
      message: "번역을 완료할 수 없습니다.",
      retryable: true,
    }]);
  });

  it("preserves completed paragraphs for permanent failure and cancellation", async () => {
    const failureTask = await prepareChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      {
        characterBudget: 1,
        concurrency: 1,
        sleep: vi.fn(async () => {}),
        jitter: () => 0,
        translate: vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
          if (chunk.chunkId === "chunk-1") throw new GeminiClientError("TRANSLATION_BLOCKED", false);
          return translated(chunk);
        }),
      },
    );
    const failed = await failureTask.execute({ apiKey: "test-key" });

    expect(failed.progress).toMatchObject({ status: "partial_failure", failedChunkIds: ["chunk-1"] });
    expect(failed.progress.translations.map(({ id }) => id)).toEqual(["p-1", "p-3"]);
    expect(failed.errors).toEqual([
      { chunkId: "chunk-1", code: "TRANSLATION_BLOCKED", message: "안전 정책으로 번역할 수 없습니다.", retryable: false },
    ]);

    const controller = new AbortController();
    const cancelTask = await prepareChapterTranslation(
      { chapter, mode: "fast", userPrompt: "" },
      {
        characterBudget: 1,
        concurrency: 1,
        sleep: vi.fn(async () => {}),
        jitter: () => 0,
        translate: vi.fn(async ({ chunk }: { chunk: { chunkId: string; paragraphs: TranslationParagraph[] } }) => {
          if (chunk.chunkId === "chunk-0") return translated(chunk);
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        }),
      },
    );
    const cancelled = await cancelTask.execute({ apiKey: "test-key", signal: controller.signal });

    expect(cancelled.progress.status).toBe("cancelled");
    expect(cancelled.progress.translations).toEqual([{ id: "p-1", text: "p-1-ko" }]);
    expect(cancelled.errors).toEqual([]);
  });

  it.each([
    ["INVALID_API_KEY", "Gemini API Key를 확인해 주세요."],
    ["MODEL_UNAVAILABLE", "선택한 번역 모델을 사용할 수 없습니다."],
  ] as const)("returns %s without retrying or changing models", async (code, message) => {
    const translate = vi.fn().mockRejectedValue(new GeminiClientError(code, false));
    const task = await prepareChapterTranslation(
      { chapter, mode: "quality", userPrompt: "" },
      { translate, concurrency: 1, sleep: vi.fn(async () => {}), jitter: () => 0 },
    );

    const result = await task.execute({ apiKey: "test-key" });

    expect(translate).toHaveBeenCalledOnce();
    expect(translate.mock.calls[0]?.[0].modelId).toBe(TRANSLATION_MODELS.quality.modelId);
    expect(result.progress.status).toBe("failed");
    expect(result.errors).toEqual([{ chunkId: "chunk-0", code, message, retryable: false }]);
  });

  it("invalidates the cache key when model, prompt, or chapter content changes", async () => {
    const base = await prepareChapterTranslation({ chapter, mode: "fast", userPrompt: "" });
    const same = await prepareChapterTranslation({ chapter: { ...chapter }, mode: "fast", userPrompt: "" });
    const model = await prepareChapterTranslation({ chapter, mode: "quality", userPrompt: "" });
    const prompt = await prepareChapterTranslation({ chapter, mode: "fast", userPrompt: "말투 유지" });
    const content = await prepareChapterTranslation({
      chapter: { ...chapter, contentHash: "b".repeat(64) },
      mode: "fast",
      userPrompt: "",
    });

    expect(same.cacheKey).toBe(base.cacheKey);
    expect(new Set([base.cacheKey, model.cacheKey, prompt.cacheKey, content.cacheKey])).toHaveLength(4);
  });
});
