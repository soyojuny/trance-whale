import "client-only";

import type { PublicError } from "../lib/errors";
import {
  TranslationCacheRecordSchema,
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
  ) {
    context.addIssue({ code: "custom", message: "Only complete chapter translations can be cached" });
  }
});

export type TranslationCachePutInput = Omit<
  TranslationCacheRecord,
  "translatedParagraphs" | "createdAt" | "accessedAt" | "byteSize"
> & {
  progress: TranslationProgress;
};

export type TranslationCachePutResult =
  | { ok: true; record: TranslationCacheRecord }
  | { ok: false; error: PublicError };

export interface TranslationCache {
  get(cacheKey: string): Promise<TranslationCacheRecord | undefined>;
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

function parseRecords(values: unknown[]): TranslationCacheRecord[] {
  return values.map((value) => TranslationCacheRecordSchema.parse(value));
}

export function calculateTranslationRecordByteSize(record: TranslationCacheRecord): number {
  const encoder = new TextEncoder();
  let byteSize = 0;
  while (true) {
    const measured = encoder.encode(JSON.stringify({ ...record, byteSize })).byteLength;
    if (measured === byteSize) return measured;
    byteSize = measured;
  }
}

function createRecord(input: TranslationCachePutInput, timestamp: string): TranslationCacheRecord {
  const progress = completeProgressSchema.parse(input.progress);
  const record = TranslationCacheRecordSchema.parse({
    cacheKey: input.cacheKey,
    canonicalUrl: input.canonicalUrl,
    contentHash: input.contentHash,
    modelId: input.modelId,
    targetLanguage: input.targetLanguage,
    basePromptVersion: input.basePromptVersion,
    userPromptHash: input.userPromptHash,
    translatedParagraphs: progress.translations,
    createdAt: timestamp,
    accessedAt: timestamp,
    byteSize: 0,
  });
  return TranslationCacheRecordSchema.parse({
    ...record,
    byteSize: calculateTranslationRecordByteSize(record),
  });
}

async function recordsByAccess(store: ReaderDbStore): Promise<TranslationCacheRecord[]> {
  const values = await store.iterateIndex<unknown>(
    READER_DB_SCHEMA.stores.translations.indexes.accessedAt,
  );
  return parseRecords(values);
}

async function removeForLimit(
  store: ReaderDbStore,
  record: TranslationCacheRecord,
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
        const record = TranslationCacheRecordSchema.parse(value);
        const refreshed = TranslationCacheRecordSchema.parse({ ...record, accessedAt: now() });
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
