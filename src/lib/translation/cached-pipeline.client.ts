import "client-only";

import type { PublicError } from "../errors";
import type { TranslationCache } from "../../services/translation-cache.client";
import type { ChapterSource } from "../../types/source";
import type { TranslationProgress } from "../../types/translation";
import {
  prepareChapterTranslation,
  type ChapterTranslationResult,
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

type ExecuteCachedChapterTranslationRequest = {
  apiKey?: string;
  signal?: AbortSignal;
  forceRetranslate?: boolean;
  onProgress?: (progress: TranslationProgress) => void;
};

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
  };
}

export async function prepareCachedChapterTranslation(
  request: PrepareCachedChapterTranslationRequest,
  dependencies: CachedPipelineDependencies,
): Promise<PreparedCachedChapterTranslation> {
  const prepared = await prepareChapterTranslation(request, dependencies.pipeline);
  const modelId = TRANSLATION_MODELS[request.mode].modelId;
  const pipelineHash = dependencies.pipeline?.hash;
  const userPromptHash = await (pipelineHash ?? hashText)(request.userPrompt);

  return {
    cacheKey: prepared.cacheKey,
    async execute(execution = {}) {
      if (!execution.forceRetranslate) {
        const cached = await dependencies.cache.get(prepared.cacheKey);
        if (cached) {
          const progress = orderedCompleteProgress(request.chapter, cached.translatedParagraphs);
          if (progress) {
            execution.onProgress?.(progress);
            return {
              cache: "hit",
              persistence: { status: "not_attempted" },
              progress,
              errors: [],
            };
          }
        }
      }

      const result = await prepared.execute({
        apiKey: execution.apiKey ?? "",
        signal: execution.signal,
        onProgress: execution.onProgress,
      });
      const complete = result.progress.status === "complete"
        ? orderedCompleteProgress(request.chapter, result.progress.translations)
        : undefined;
      if (!complete) {
        return {
          ...result,
          cache: execution.forceRetranslate ? "bypassed" : "miss",
          persistence: { status: "not_attempted" },
        };
      }

      const stored = await dependencies.cache.put({
        cacheKey: prepared.cacheKey,
        canonicalUrl: request.chapter.canonicalUrl,
        contentHash: request.chapter.contentHash,
        modelId,
        targetLanguage: TARGET_LANGUAGE,
        basePromptVersion: BASE_PROMPT_VERSION,
        userPromptHash,
        progress: complete,
      });

      return {
        ...result,
        progress: complete,
        cache: execution.forceRetranslate ? "bypassed" : "miss",
        persistence: stored.ok
          ? { status: "saved" }
          : { status: "failed", error: stored.error },
      };
    },
  };
}
