import "client-only";

import { TranslationOutputError } from "../errors";
import { chunkParagraphs, type TranslationChunk } from "./chunk";
import { GeminiClientError, translateChunk } from "../../services/gemini.client";
import type {
  TranslationParagraph,
  TranslationProgress,
  TranslationProgressStatus,
} from "../../types/translation";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

type Translate = (request: {
  apiKey: string;
  modelId: string;
  userPrompt: string;
  chunk: TranslationChunk;
  signal: AbortSignal;
}) => Promise<TranslationParagraph[]>;

type OrchestratorRequest = {
  paragraphs: readonly TranslationParagraph[];
  apiKey: string;
  modelId: string;
  userPrompt: string;
  signal?: AbortSignal;
  characterBudget?: number;
  onProgress?: (progress: TranslationProgress) => void;
};

type OrchestratorDependencies = {
  translate?: Translate;
  sleep?: (milliseconds: number) => Promise<void>;
  jitter?: () => number;
  concurrency?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRetryable(error: unknown): boolean {
  return (
    error instanceof TranslationOutputError ||
    error instanceof TypeError ||
    (error instanceof GeminiClientError && error.retryable)
  );
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
  const chunks = chunkParagraphs(request.paragraphs, request.characterBudget);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  request.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (request.signal?.aborted) controller.abort();

  const translations = new Map<string, TranslationParagraph>();
  const failedChunkIds: string[] = [];
  const sourceOrder = new Map(request.paragraphs.map((paragraph, index) => [paragraph.id, index]));
  let nextChunkIndex = 0;

  const snapshot = (status: TranslationProgressStatus): TranslationProgress => {
    const orderedTranslations = [...translations.values()].sort(
      (left, right) => (sourceOrder.get(left.id) ?? 0) - (sourceOrder.get(right.id) ?? 0),
    );
    return {
      status,
      completedParagraphs: orderedTranslations.length,
      totalParagraphs: request.paragraphs.length,
      translations: orderedTranslations,
      failedChunkIds: [...failedChunkIds],
    };
  };

  const runChunk = async (chunk: TranslationChunk): Promise<void> => {
    for (let attempt = 0; ; attempt += 1) {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const completed = await translate({
          apiKey: request.apiKey,
          modelId: request.modelId,
          userPrompt: request.userPrompt,
          chunk,
          signal: controller.signal,
        });
        completed.forEach((paragraph) => translations.set(paragraph.id, paragraph));
        request.onProgress?.(snapshot("translating"));
        return;
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) throw error;
        if (!isRetryable(error) || attempt >= maxRetries) {
          failedChunkIds.push(chunk.chunkId);
          return;
        }
        const delay = retryBaseDelayMs * 2 ** attempt + Math.max(0, jitter());
        await abortableSleep(delay, controller.signal, sleep);
      }
    }
  };

  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = nextChunkIndex;
      nextChunkIndex += 1;
      const chunk = chunks[index];
      if (!chunk) return;
      await runChunk(chunk);
    }
  };

  let cancelled = controller.signal.aborted;
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()));
  } catch (error) {
    if (!isAbortError(error) && !controller.signal.aborted) throw error;
    cancelled = true;
    controller.abort();
  } finally {
    request.signal?.removeEventListener("abort", forwardAbort);
  }

  let status: TranslationProgressStatus;
  if (cancelled || controller.signal.aborted) status = "cancelled";
  else if (failedChunkIds.length === 0) status = "complete";
  else if (translations.size > 0) status = "partial_failure";
  else status = "failed";

  const result = snapshot(status);
  request.onProgress?.(result);
  return result;
}
