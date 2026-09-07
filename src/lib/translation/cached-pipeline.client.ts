import "client-only";

import type { PublicError } from "../errors";
import {
  createTranslationCacheWriteScheduler,
  isCompleteTranslationCacheRecord,
  type TranslationCache,
} from "../../services/translation-cache.client";
import type { ChapterSource } from "../../types/source";
import type { PartialTranslationCacheRecord } from "../../types/storage";
import type { TranslationParagraph, TranslationProgress } from "../../types/translation";
import {
  prepareChapterTranslation,
  type ChapterTranslationResult,
  type FailedChunkRetry,
} from "./pipeline.client";
import { TRANSLATION_MODELS, type TranslationMode } from "./models";
import { BASE_PROMPT_VERSION } from "./prompt";

const TARGET_LANGUAGE = "ko" as const;

type PipelineDependencies = NonNullable<Parameters<typeof prepareChapterTranslation>[1]>;

type PrepareCachedChapterTranslationRequest = {
  chapter: ChapterSource;
  mode: TranslationMode;
  userPrompt: string;
};

type ExecuteCachedChapterTranslationCommon = {
  apiKey?: string;
  signal?: AbortSignal;
  onProgress?: (progress: TranslationProgress) => void;
};

export type ExecuteCachedChapterTranslationRequest = ExecuteCachedChapterTranslationCommon & (
  | { forceRetranslate: true; retryFailed?: never }
  | { forceRetranslate?: false; retryFailed?: FailedChunkRetry }
);

export type TranslationPersistenceResult =
  | { status: "not_attempted" }
  | { status: "saved" }
  | { status: "failed"; error: PublicError };

export type CachedChapterTranslationResult = ChapterTranslationResult & {
  cache: "hit" | "miss" | "bypassed";
  persistence: TranslationPersistenceResult;
};

type CachedPipelineDependencies = {
  cache: TranslationCache;
  pipeline?: PipelineDependencies;
};

export type PreparedCachedChapterTranslation = {
  cacheKey: string;
  getCached(): Promise<CachedChapterTranslationResult | undefined>;
  execute(request?: ExecuteCachedChapterTranslationRequest): Promise<CachedChapterTranslationResult>;
};

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function orderedCompleteProgress(
  chapter: ChapterSource,
  translations: TranslationProgress["translations"],
): TranslationProgress | undefined {
  if (translations.length !== chapter.paragraphs.length) return undefined;
  const byId = new Map(translations.map((paragraph) => [paragraph.id, paragraph]));
  if (byId.size !== chapter.paragraphs.length) return undefined;
  const ordered = chapter.paragraphs.map(({ id }) => byId.get(id));
  if (ordered.some((paragraph) => typeof paragraph === "undefined")) return undefined;

  return {
    status: "complete",
    completedParagraphs: chapter.paragraphs.length,
    totalParagraphs: chapter.paragraphs.length,
    translations: ordered as TranslationProgress["translations"],
    failedChunkIds: [],
    unfinishedParagraphIds: [],
    failedParagraphIds: [],
  };
}

function orderedPartialTranslations(
  chapter: ChapterSource,
  record: PartialTranslationCacheRecord,
): TranslationParagraph[] | undefined {
  if (record.totalParagraphs !== chapter.paragraphs.length) return undefined;
  const byId = new Map(record.translatedParagraphs.map((paragraph) => [paragraph.id, paragraph]));
  if (byId.size !== record.translatedParagraphs.length) return undefined;
  const sourceIds = new Set(chapter.paragraphs.map(({ id }) => id));
  if ([...byId.keys()].some((id) => !sourceIds.has(id))) return undefined;

  const unfinished = chapter.paragraphs.filter(({ id }) => !byId.has(id)).map(({ id }) => id);
  if (
    unfinished.length !== record.unfinishedParagraphIds.length
    || unfinished.some((id) => !record.unfinishedParagraphIds.includes(id))
    || record.failedParagraphIds.some((id) => !unfinished.includes(id))
  ) {
    return undefined;
  }
  return chapter.paragraphs.flatMap(({ id }) => {
    const paragraph = byId.get(id);
    return paragraph ? [paragraph] : [];
  });
}

export async function prepareCachedChapterTranslation(
  request: PrepareCachedChapterTranslationRequest,
  dependencies: CachedPipelineDependencies,
): Promise<PreparedCachedChapterTranslation> {
  const prepared = await prepareChapterTranslation(request, dependencies.pipeline);
  const modelId = TRANSLATION_MODELS[request.mode].modelId;
  const pipelineHash = dependencies.pipeline?.hash;
  const userPromptHash = await (pipelineHash ?? hashText)(request.userPrompt);
  const cacheRecord = {
    cacheKey: prepared.cacheKey,
    canonicalUrl: request.chapter.canonicalUrl,
    contentHash: request.chapter.contentHash,
    modelId,
    targetLanguage: TARGET_LANGUAGE,
    basePromptVersion: BASE_PROMPT_VERSION,
    userPromptHash,
  } as const;

  const getCached = async (): Promise<CachedChapterTranslationResult | undefined> => {
    const cached = await dependencies.cache.get(prepared.cacheKey, cacheRecord);
    if (!cached || !isCompleteTranslationCacheRecord(cached)) return undefined;

    const progress = orderedCompleteProgress(request.chapter, cached.translatedParagraphs);
    if (!progress) return undefined;

    return {
      cache: "hit",
      persistence: { status: "not_attempted" },
      progress,
      errors: [],
    };
  };

  return {
    cacheKey: prepared.cacheKey,
    getCached,
    async execute(execution = {}) {
      let initialTranslations: readonly TranslationParagraph[] | undefined;
      if (!execution.forceRetranslate && !execution.retryFailed) {
        const cached = await dependencies.cache.get(prepared.cacheKey, cacheRecord);
        if (cached && isCompleteTranslationCacheRecord(cached)) {
          const progress = orderedCompleteProgress(request.chapter, cached.translatedParagraphs);
          if (progress) {
            const hit: CachedChapterTranslationResult = {
              cache: "hit",
              persistence: { status: "not_attempted" },
              progress,
              errors: [],
            };
            execution.onProgress?.(progress);
            return hit;
          }
        } else if (cached) {
          initialTranslations = orderedPartialTranslations(request.chapter, cached);
        }
      }

      const scheduler = createTranslationCacheWriteScheduler({
        cache: dependencies.cache,
        record: cacheRecord,
      });
      const result = await prepared.execute({
        apiKey: execution.apiKey ?? "",
        signal: execution.signal,
        onProgress: (progress) => {
          scheduler.schedule(progress);
          execution.onProgress?.(progress);
        },
        initialTranslations,
        retryFailed: execution.retryFailed,
      });
      const complete = result.progress.status === "complete"
        ? orderedCompleteProgress(request.chapter, result.progress.translations)
        : undefined;
      const stored = await scheduler.flush();

      return {
        ...result,
        progress: complete ?? result.progress,
        cache: execution.forceRetranslate ? "bypassed" : "miss",
        persistence: !stored
          ? { status: "not_attempted" }
          : stored.ok
          ? { status: "saved" }
          : { status: "failed", error: stored.error },
      };
    },
  };
}
