import "client-only";

import { TranslationOutputError } from "../errors";
import { chunkParagraphs, type TranslationChunk } from "./chunk";
import {
  consoleTranslationDiagnosticLogger,
  createTranslationRunId,
  reportTranslationDiagnostic,
  type TranslationDiagnosticEvent,
  type TranslationDiagnosticLogger,
} from "./diagnostics.client";
import { validateTranslationOutput } from "./validate-output";
import { GeminiClientError, translateChunk } from "../../services/gemini.client";
import {
  TranslationParagraphSchema,
  type TranslationParagraph,
  type TranslationProgress,
  type TranslationProgressStatus,
} from "../../types/translation";

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

export type Translate = (request: {
  apiKey: string;
  modelId: string;
  userPrompt: string;
  chunk: TranslationChunk;
  signal: AbortSignal;
  runId: string;
  attempt: number;
  diagnosticLogger: TranslationDiagnosticLogger;
  onProgress?: (paragraph: TranslationParagraph) => void;
}) => Promise<TranslationParagraph[]>;

type OrchestratorRequest = {
  paragraphs: readonly TranslationParagraph[];
  apiKey: string;
  modelId: string;
  userPrompt: string;
  signal?: AbortSignal;
  characterBudget?: number;
  chunkIds?: readonly string[];
  initialTranslations?: readonly TranslationParagraph[];
  onProgress?: (progress: TranslationProgress) => void;
};

export type OrchestratorDependencies = {
  translate?: Translate;
  sleep?: (milliseconds: number) => Promise<void>;
  jitter?: () => number;
  concurrency?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  diagnosticLogger?: TranslationDiagnosticLogger;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof GeminiClientError && error.code !== "QUOTA_EXCEEDED" && error.retryable)
  );
}

function diagnosticFailure(
  error: unknown,
  runId: string,
  chunkId: string,
  attempt: number,
  willRetry: boolean,
): TranslationDiagnosticEvent {
  if (error instanceof TranslationOutputError) {
    return {
      event: "attempt_failed",
      runId,
      chunkId,
      attempt,
      errorType: "output_contract",
      errorCode: error.reason,
      retryable: false,
      willRetry,
    };
  }
  if (error instanceof GeminiClientError) {
    return {
      event: "attempt_failed",
      runId,
      chunkId,
      attempt,
      errorType: "gemini",
      errorCode: error.code,
      retryable: isRetryable(error),
      willRetry,
    };
  }
  return {
    event: "attempt_failed",
    runId,
    chunkId,
    attempt,
    errorType: error instanceof TypeError ? "network" : "unknown",
    retryable: isRetryable(error),
    willRetry,
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative integer`);
  return value;
}

function abortableSleep(
  milliseconds: number,
  signal: AbortSignal,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    sleep(milliseconds).then(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export async function orchestrateTranslation(
  request: OrchestratorRequest,
  dependencies: OrchestratorDependencies = {},
): Promise<TranslationProgress> {
  const concurrency = positiveInteger(dependencies.concurrency ?? DEFAULT_CONCURRENCY, "concurrency");
  const maxRetries = nonnegativeInteger(dependencies.maxRetries ?? DEFAULT_MAX_RETRIES, "maxRetries");
  const retryBaseDelayMs = nonnegativeInteger(
    dependencies.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    "retryBaseDelayMs",
  );
  const translate = dependencies.translate ?? translateChunk;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const jitter = dependencies.jitter ?? (() => Math.floor(Math.random() * 101));
  const diagnosticLogger = dependencies.diagnosticLogger ?? consoleTranslationDiagnosticLogger;
  const runId = createTranslationRunId();
  const controller = new AbortController();

  const translations = new Map<string, TranslationParagraph>();
  const failedChunkIds: string[] = [];
  const failedParagraphIds = new Set<string>();
  const outputFailureChunkIds = new Set<string>();
  const sourceOrder = new Map(request.paragraphs.map((paragraph, index) => [paragraph.id, index]));
  const seeds = TranslationParagraphSchema.array().safeParse(request.initialTranslations ?? []);
  if (!seeds.success) throw new TranslationOutputError("INVALID_SCHEMA");
  for (const paragraph of seeds.data) {
    if (!sourceOrder.has(paragraph.id) || translations.has(paragraph.id)) {
      throw new TranslationOutputError("UNEXPECTED_ID");
    }
    translations.set(paragraph.id, paragraph);
  }
  const missingParagraphs = request.paragraphs.filter(({ id }) => !translations.has(id));
  const chunks = chunkParagraphs(request.chunkIds ? request.paragraphs : missingParagraphs, request.characterBudget);
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  if (request.chunkIds && new Set(request.chunkIds).size !== request.chunkIds.length) {
    throw new TranslationOutputError("DUPLICATE_ID");
  }
  const selectedChunks = (request.chunkIds
    ? request.chunkIds.map((chunkId) => {
      const chunk = chunksById.get(chunkId);
      if (!chunk) throw new TranslationOutputError("UNEXPECTED_ID");
      return { ...chunk, paragraphs: chunk.paragraphs.filter(({ id }) => !translations.has(id)) };
    })
    : chunks).filter((chunk) => chunk.paragraphs.length > 0)
    .sort((left, right) => sourceOrder.get(left.paragraphs[0].id)! - sourceOrder.get(right.paragraphs[0].id)!);
  const forwardAbort = () => controller.abort();
  request.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (request.signal?.aborted) controller.abort();
  let nextChunkIndex = 0;

  const snapshot = (status: TranslationProgressStatus): TranslationProgress => {
    const orderedTranslations = [...translations.values()].map((paragraph) => ({ ...paragraph })).sort(
      (left, right) => (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0),
    );
    return {
      status,
      completedParagraphs: orderedTranslations.length,
      totalParagraphs: request.paragraphs.length,
      translations: orderedTranslations,
      failedChunkIds: [...failedChunkIds],
      unfinishedParagraphIds: request.paragraphs.filter(({ id }) => !translations.has(id)).map(({ id }) => id),
      failedParagraphIds: request.paragraphs.filter(({ id }) => failedParagraphIds.has(id) && !translations.has(id)).map(({ id }) => id),
    };
  };

  const runChunk = async (chunk: TranslationChunk): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const attemptNumber = attempt + 1;
      const attemptChunk = { ...chunk, paragraphs: chunk.paragraphs.filter(({ id }) => !translations.has(id)) };
      const streamed = new Map<string, TranslationParagraph>();
      let acceptingProgress = true;
      reportTranslationDiagnostic(diagnosticLogger, {
        event: "attempt_started",
        runId,
        chunkId: chunk.chunkId,
        attempt: attemptNumber,
      });
      try {
        const completed = await translate({
          apiKey: request.apiKey,
          modelId: request.modelId,
          userPrompt: request.userPrompt,
          chunk: attemptChunk,
          signal: controller.signal,
          runId,
          attempt: attemptNumber,
          diagnosticLogger,
          onProgress: (candidate) => {
            if (!acceptingProgress || controller.signal.aborted) return;
            const parsed = TranslationParagraphSchema.safeParse(candidate);
            if (!parsed.success) throw new TranslationOutputError("INVALID_SCHEMA");
            const paragraph = parsed.data;
            const previous = streamed.get(paragraph.id);
            if (previous) {
              if (previous.text !== paragraph.text) throw new TranslationOutputError("DUPLICATE_ID");
              return;
            }
            if (paragraph.id !== attemptChunk.paragraphs[streamed.size]?.id) {
              throw new TranslationOutputError("OUT_OF_ORDER");
            }
            streamed.set(paragraph.id, paragraph);
            translations.set(paragraph.id, paragraph);
            request.onProgress?.(snapshot("translating"));
          },
        });
        acceptingProgress = false;
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const validated = validateTranslationOutput(JSON.stringify({ translations: completed }), attemptChunk);
        for (const paragraph of validated) {
          const previous = streamed.get(paragraph.id);
          if (previous && previous.text !== paragraph.text) throw new TranslationOutputError("INVALID_SCHEMA");
        }
        const hadNewParagraphs = validated.some(({ id }) => !translations.has(id));
        validated.forEach((paragraph) => translations.set(paragraph.id, paragraph));
        reportTranslationDiagnostic(diagnosticLogger, {
          event: "attempt_succeeded",
          runId,
          chunkId: chunk.chunkId,
          attempt: attemptNumber,
          translationCount: completed.length,
        });
        if (hadNewParagraphs) request.onProgress?.(snapshot("translating"));
        return;
      } catch (error) {
        acceptingProgress = false;
        if (isAbortError(error) || controller.signal.aborted) throw error;
        if (error instanceof TranslationOutputError) outputFailureChunkIds.add(chunk.chunkId);
        const unfinished = chunk.paragraphs.filter(({ id }) => !translations.has(id));
        const willRetry = isRetryable(error) && attempt < maxRetries && unfinished.length > 0;
        reportTranslationDiagnostic(
          diagnosticLogger,
          diagnosticFailure(error, runId, chunk.chunkId, attemptNumber, willRetry),
        );
        if (!willRetry) {
          failedChunkIds.push(chunk.chunkId);
          unfinished.forEach(({ id }) => failedParagraphIds.add(id));
          return;
        }
        const delay = retryBaseDelayMs * 2 ** attempt + Math.max(0, jitter());
        reportTranslationDiagnostic(diagnosticLogger, {
          event: "retry_scheduled",
          runId,
          chunkId: chunk.chunkId,
          attempt: attemptNumber,
          delayMs: delay,
        });
        await abortableSleep(delay, controller.signal, sleep);
      } finally {
        acceptingProgress = false;
      }
    }
  };

  if (translations.size > 0) request.onProgress?.(snapshot("translating"));

  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = nextChunkIndex;
      nextChunkIndex += 1;
      const chunk = selectedChunks[index];
      if (!chunk) return;
      await runChunk(chunk);
    }
  };

  let cancelled = controller.signal.aborted;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, selectedChunks.length) }, () => worker()));
  } catch (error) {
    if (!isAbortError(error) && !controller.signal.aborted) throw error;
    cancelled = true;
    controller.abort();
  } finally {
    request.signal?.removeEventListener("abort", forwardAbort);
  }

  let status: TranslationProgressStatus;
  if (cancelled || controller.signal.aborted) status = "cancelled";
  else if (failedChunkIds.length === 0 && translations.size === request.paragraphs.length) status = "complete";
  else if (translations.size > 0 || outputFailureChunkIds.size > 0) status = "partial_failure";
  else status = "failed";

  const result = snapshot(status);
  request.onProgress?.(result);
  return result;
}
