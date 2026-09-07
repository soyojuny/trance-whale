import "client-only";

import { TranslationOutputError, type PublicError } from "../errors";
import { chunkParagraphs } from "./chunk";
import { GeminiClientError, translateChunk } from "../../services/gemini.client";
import { ChapterSourceSchema, type ChapterSource } from "../../types/source";
import {
  TranslationParagraphSchema,
  type TranslationParagraph,
  type TranslationProgress,
} from "../../types/translation";
import {
  createTranslationCacheKey,
  type HashText,
} from "./cache-key.client";
import { TRANSLATION_MODELS, TranslationModeSchema, type TranslationMode } from "./models";
import {
  orchestrateTranslation,
  type OrchestratorDependencies,
  type Translate,
} from "./orchestrator.client";
import { BASE_PROMPT_VERSION, UserPromptSchema } from "./prompt";

const TARGET_LANGUAGE = "ko";

export type ChapterTranslationProgress = TranslationProgress;

export type ChapterTranslationError = PublicError & {
  chunkId: string;
};

export type ChapterTranslationResult = {
  progress: ChapterTranslationProgress;
  errors: ChapterTranslationError[];
};

type PrepareChapterTranslationRequest = {
  chapter: ChapterSource;
  mode: TranslationMode;
  userPrompt: string;
};

export type FailedChunkRetry = {
  failedChunkIds: readonly string[];
  successfulTranslations: readonly TranslationParagraph[];
};

export type ExecuteChapterTranslationRequest = {
  apiKey: string;
  signal?: AbortSignal;
  onProgress?: (progress: ChapterTranslationProgress) => void;
  initialTranslations?: readonly TranslationParagraph[];
  retryFailed?: FailedChunkRetry;
};

type PipelineDependencies = OrchestratorDependencies & {
  hash?: HashText;
  characterBudget?: number;
};

export type PreparedChapterTranslation = {
  cacheKey: string;
  execute(request: ExecuteChapterTranslationRequest): Promise<ChapterTranslationResult>;
};

function validateFailedChunkRetry(
  chapter: ChapterSource,
  retry: FailedChunkRetry,
  characterBudget: number | undefined,
): boolean {
  const chunks = chunkParagraphs(chapter.paragraphs, characterBudget);
  const failedIds = new Set(retry.failedChunkIds);
  if (failedIds.size === 0 || failedIds.size !== retry.failedChunkIds.length) return false;
  if (retry.failedChunkIds.some((chunkId) => !chunks.some((chunk) => chunk.chunkId === chunkId))) return false;

  const parsedSuccesses = TranslationParagraphSchema.array().safeParse(retry.successfulTranslations);
  if (!parsedSuccesses.success) return false;

  const failedParagraphIds = new Set(
    chunks.filter((chunk) => failedIds.has(chunk.chunkId)).flatMap((chunk) => chunk.paragraphs.map(({ id }) => id)),
  );
  const successIds = parsedSuccesses.data.map(({ id }) => id);
  const sourceIds = new Set(chapter.paragraphs.map(({ id }) => id));
  const successfulIds = new Set(successIds);
  const missingIds = chapter.paragraphs.map(({ id }) => id).filter((id) => !successfulIds.has(id));
  return (
    successfulIds.size === successIds.length
    && successIds.every((id) => sourceIds.has(id))
    && missingIds.length > 0
    && missingIds.every((id) => failedParagraphIds.has(id))
  );
}

function safeTranslationError(error: unknown): PublicError {
  if (error instanceof GeminiClientError) return error.toJSON();
  if (error instanceof TranslationOutputError) {
    return {
      code: "TRANSLATION_FAILED",
      message: "번역을 완료할 수 없습니다.",
      retryable: true,
    };
  }
  return {
    code: "TRANSLATION_FAILED",
    message: "번역을 완료할 수 없습니다.",
    retryable: false,
  };
}

export async function prepareChapterTranslation(
  request: PrepareChapterTranslationRequest,
  dependencies: PipelineDependencies = {},
): Promise<PreparedChapterTranslation> {
  const chapter = ChapterSourceSchema.parse(request.chapter);
  const mode = TranslationModeSchema.parse(request.mode);
  const userPrompt = UserPromptSchema.parse(request.userPrompt);
  const modelId = TRANSLATION_MODELS[mode].modelId;
  const cacheKey = await createTranslationCacheKey(
    {
      canonicalUrl: chapter.canonicalUrl,
      contentHash: chapter.contentHash,
      modelId,
      targetLanguage: TARGET_LANGUAGE,
      basePromptVersion: BASE_PROMPT_VERSION,
      userPrompt,
    },
    dependencies.hash,
  );

  const translate = dependencies.translate ?? translateChunk;

  return {
    cacheKey,
    async execute(execution): Promise<ChapterTranslationResult> {
      if (
        execution.retryFailed
        && !validateFailedChunkRetry(chapter, execution.retryFailed, dependencies.characterBudget)
      ) {
        return {
          progress: {
            status: "failed",
            completedParagraphs: 0,
            totalParagraphs: chapter.paragraphs.length,
            translations: [],
            failedChunkIds: [],
          },
          errors: [{
            chunkId: "retry",
            code: "TRANSLATION_FAILED",
            message: "번역을 완료할 수 없습니다.",
            retryable: false,
          }],
        };
      }
      const latestErrors = new Map<string, unknown>();
      const trackedTranslate: Translate = async (translationRequest) => {
        try {
          const result = await translate(translationRequest);
          latestErrors.delete(translationRequest.chunk.chunkId);
          return result;
        } catch (error) {
          latestErrors.set(translationRequest.chunk.chunkId, error);
          throw error;
        }
      };
      const progress = await orchestrateTranslation(
        {
          paragraphs: chapter.paragraphs,
          apiKey: execution.apiKey,
          modelId,
          userPrompt,
          signal: execution.signal,
          characterBudget: dependencies.characterBudget,
          chunkIds: execution.retryFailed?.failedChunkIds,
          initialTranslations: execution.retryFailed?.successfulTranslations ?? execution.initialTranslations,
          onProgress: execution.onProgress,
        },
        {
          translate: trackedTranslate,
          sleep: dependencies.sleep,
          jitter: dependencies.jitter,
          concurrency: dependencies.concurrency,
          maxRetries: dependencies.maxRetries,
          retryBaseDelayMs: dependencies.retryBaseDelayMs,
        },
      );
      const errors = progress.failedChunkIds.map((chunkId) => ({
        chunkId,
        ...safeTranslationError(latestErrors.get(chunkId)),
      }));

      return { progress, errors };
    },
  };
}
