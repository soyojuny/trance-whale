import "client-only";

import type { PublicError } from "../lib/errors";
import {
  PartialTranslationCacheRecordSchema,
  StoredTranslationCacheRecordSchema,
  TranslationCacheRecordSchema,
  type StoredTranslationCacheRecord,
  type TranslationCacheRecord,
} from "../types/storage";
import { TranslationProgressSchema, type TranslationProgress } from "../types/translation";
import {
  READER_DB_SCHEMA,
  ReaderDatabaseError,
  type ReaderDatabase,
  type ReaderDbStore,
} from "./reader-db.client";

export const DEFAULT_TRANSLATION_CACHE_MAX_BYTES = 100 * 1024 * 1024;

const cacheKeySchema = TranslationCacheRecordSchema.shape.cacheKey;
const completeProgressSchema = TranslationProgressSchema.superRefine((progress, context) => {
  if (
    progress.status !== "complete"
    || progress.completedParagraphs !== progress.totalParagraphs
    || progress.failedChunkIds.length > 0
    || (progress.unfinishedParagraphIds?.length ?? 0) > 0
    || (progress.failedParagraphIds?.length ?? 0) > 0
  ) {
    context.addIssue({ code: "custom", message: "Only complete chapter translations can be cached" });
  }
});

const partialProgressSchema = TranslationProgressSchema.superRefine((progress, context) => {
  if (
    progress.status === "complete"
    || progress.translations.length === 0
    || !progress.unfinishedParagraphIds
    || !progress.failedParagraphIds
  ) {
    context.addIssue({
      code: "custom",
      message: "Partial cache progress requires translated, unfinished, and failed paragraph IDs",
    });
  }
});

export type TranslationCachePutInput = Omit<
  TranslationCacheRecord,
  "kind" | "translatedParagraphs" | "createdAt" | "accessedAt" | "byteSize"
> & {
  progress: TranslationProgress;
};

export type TranslationCacheRecordMetadata = Omit<TranslationCachePutInput, "progress">;

export type TranslationCachePutResult =
  | { ok: true; record: StoredTranslationCacheRecord }
  | { ok: false; error: PublicError };

export interface TranslationCache {
  get(cacheKey: string): Promise<StoredTranslationCacheRecord | undefined>;
  put(input: TranslationCachePutInput): Promise<TranslationCachePutResult>;
  delete(cacheKey: string): Promise<void>;
  clear(): Promise<void>;
}

type TranslationCacheOptions = {
  database: ReaderDatabase;
  now?: () => string;
  maxBytes?: number;
};

const storageFullError: PublicError = {
  code: "STORAGE_FULL",
  message: "브라우저 저장 공간이 부족합니다.",
  retryable: true,
};

function parseRecords(values: unknown[]): StoredTranslationCacheRecord[] {
  return values.map((value) => StoredTranslationCacheRecordSchema.parse(value));
}

export function calculateTranslationRecordByteSize(record: StoredTranslationCacheRecord): number {
  const encoder = new TextEncoder();
  let byteSize = 0;
  while (true) {
    const measured = encoder.encode(JSON.stringify({ ...record, byteSize })).byteLength;
    if (measured === byteSize) return measured;
    byteSize = measured;
  }
}

function recordBase(input: TranslationCachePutInput, timestamp: string) {
  return {
    cacheKey: input.cacheKey,
    canonicalUrl: input.canonicalUrl,
    contentHash: input.contentHash,
    modelId: input.modelId,
    targetLanguage: input.targetLanguage,
    basePromptVersion: input.basePromptVersion,
    userPromptHash: input.userPromptHash,
    createdAt: timestamp,
    accessedAt: timestamp,
    byteSize: 0,
  };
}

function createRecord(input: TranslationCachePutInput, timestamp: string): StoredTranslationCacheRecord {
  const parsedProgress = TranslationProgressSchema.parse(input.progress);
  const record = parsedProgress.status === "complete"
    ? TranslationCacheRecordSchema.parse({
      ...recordBase(input, timestamp),
      kind: "complete",
      translatedParagraphs: completeProgressSchema.parse(parsedProgress).translations,
    })
    : PartialTranslationCacheRecordSchema.parse({
      ...recordBase(input, timestamp),
      kind: "partial",
      progressStatus: parsedProgress.status,
      translatedParagraphs: partialProgressSchema.parse(parsedProgress).translations,
      totalParagraphs: parsedProgress.totalParagraphs,
      unfinishedParagraphIds: parsedProgress.unfinishedParagraphIds,
      failedParagraphIds: parsedProgress.failedParagraphIds,
    });
  return StoredTranslationCacheRecordSchema.parse({
    ...record,
    byteSize: calculateTranslationRecordByteSize(record),
  });
}

async function recordsByAccess(store: ReaderDbStore): Promise<StoredTranslationCacheRecord[]> {
  const values = await store.iterateIndex<unknown>(
    READER_DB_SCHEMA.stores.translations.indexes.accessedAt,
  );
  return parseRecords(values);
}

async function removeForLimit(
  store: ReaderDbStore,
  record: StoredTranslationCacheRecord,
  maxBytes: number,
): Promise<void> {
  const records = await recordsByAccess(store);
  let usedBytes = records.reduce(
    (total, existing) => total + (existing.cacheKey === record.cacheKey ? 0 : existing.byteSize),
    0,
  );
  for (const existing of records) {
    if (usedBytes + record.byteSize <= maxBytes) break;
    if (existing.cacheKey === record.cacheKey) continue;
    await store.delete(existing.cacheKey);
    usedBytes -= existing.byteSize;
  }
}

export function createTranslationCache({
  database,
  now = () => new Date().toISOString(),
  maxBytes = DEFAULT_TRANSLATION_CACHE_MAX_BYTES,
}: TranslationCacheOptions): TranslationCache {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new RangeError("Translation cache maximum size must be a non-negative safe integer");
  }
  const storeName = READER_DB_SCHEMA.stores.translations.name;

  return {
    async get(cacheKey) {
      const key = cacheKeySchema.parse(cacheKey);
      return database.run(storeName, "readwrite", async (store) => {
        const value = await store.get<unknown>(key);
        if (typeof value === "undefined") return undefined;
        const record = StoredTranslationCacheRecordSchema.parse(value);
        const refreshed = StoredTranslationCacheRecordSchema.parse({ ...record, accessedAt: now() });
        await store.put(refreshed);
        return refreshed;
      });
    },

    async put(input) {
      const record = createRecord(input, now());
      if (record.byteSize > maxBytes) return { ok: false, error: storageFullError };

      const write = () => database.run(storeName, "readwrite", async (store) => {
        await removeForLimit(store, record, maxBytes);
        await store.put(record);
      });

      try {
        await write();
      } catch (error) {
        if (!(error instanceof ReaderDatabaseError) || error.kind !== "QUOTA_EXCEEDED") throw error;

        await database.run(storeName, "readwrite", async (store) => {
          const oldest = (await recordsByAccess(store)).find(
            (existing) => existing.cacheKey !== record.cacheKey,
          );
          if (oldest) await store.delete(oldest.cacheKey);
        });
        try {
          await write();
        } catch (retryError) {
          if (retryError instanceof ReaderDatabaseError && retryError.kind === "QUOTA_EXCEEDED") {
            return { ok: false, error: storageFullError };
          }
          throw retryError;
        }
      }
      return { ok: true, record };
    },

    async delete(cacheKey) {
      const key = cacheKeySchema.parse(cacheKey);
      await database.run(storeName, "readwrite", (store) => store.delete(key));
    },

    async clear() {
      await database.run(storeName, "readwrite", async (store) => {
        const records = await recordsByAccess(store);
        for (const record of records) await store.delete(record.cacheKey);
      });
    },
  };
}

export function isCompleteTranslationCacheRecord(
  record: StoredTranslationCacheRecord,
): record is TranslationCacheRecord {
  return record.kind !== "partial";
}

export type TranslationCacheWriteScheduler = {
  schedule(progress: TranslationProgress): void;
  flush(): Promise<TranslationCachePutResult | undefined>;
};

type TranslationCacheWriteSchedulerOptions = {
  cache: TranslationCache;
  record: TranslationCacheRecordMetadata;
  delayMs?: number;
};

export function createTranslationCacheWriteScheduler({
  cache,
  record,
  delayMs = 250,
}: TranslationCacheWriteSchedulerOptions): TranslationCacheWriteScheduler {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new RangeError("Translation cache write delay must be a non-negative safe integer");
  }

  let pending: TranslationProgress | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<TranslationCachePutResult | undefined> | undefined;

  const clearPendingTimer = () => {
    if (typeof timer === "undefined") return;
    clearTimeout(timer);
    timer = undefined;
  };

  const flush = (): Promise<TranslationCachePutResult | undefined> => {
    clearPendingTimer();
    if (!active) {
      active = (async () => {
        let result: TranslationCachePutResult | undefined;
        while (pending) {
          const progress = pending;
          pending = undefined;
          result = await cache.put({ ...record, progress });
        }
        return result;
      })().finally(() => {
        active = undefined;
      });
    }
    return active.then((result) => pending ? flush() : result);
  };

  return {
    schedule(progress) {
      const parsed = TranslationProgressSchema.parse(progress);
      if (parsed.translations.length === 0) return;
      pending = parsed;
      clearPendingTimer();
      timer = setTimeout(() => {
        timer = undefined;
        void flush().catch(() => undefined);
      }, delayMs);
    },
    flush,
  };
}
