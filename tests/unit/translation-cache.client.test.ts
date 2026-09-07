import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderDatabaseError, type ReaderDatabase, type ReaderDbStore } from "../../src/services/reader-db.client";
import {
  calculateTranslationRecordByteSize,
  createTranslationCache,
  createTranslationCacheWriteScheduler,
  isCompleteTranslationCacheRecord,
  type TranslationCachePutInput,
} from "../../src/services/translation-cache.client";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function completeInput(overrides: Partial<TranslationCachePutInput> = {}): TranslationCachePutInput {
  return {
    cacheKey: HASH_A,
    canonicalUrl: "https://www.69shuba.com/txt/1/2",
    contentHash: HASH_B,
    modelId: "gemini-test",
    targetLanguage: "ko",
    basePromptVersion: "v1",
    userPromptHash: HASH_A,
    progress: {
      status: "complete",
      completedParagraphs: 2,
      totalParagraphs: 2,
      translations: [{ id: "p1", text: "첫 문단" }, { id: "p2", text: "second" }],
      failedChunkIds: [],
    },
    ...overrides,
  };
}

function partialInput(overrides: Partial<TranslationCachePutInput> = {}): TranslationCachePutInput {
  return completeInput({
    progress: {
      status: "partial_failure",
      completedParagraphs: 1,
      totalParagraphs: 2,
      translations: [{ id: "p1", text: "완료" }],
      failedChunkIds: ["chunk-2"],
      unfinishedParagraphIds: ["p2"],
      failedParagraphIds: ["p2"],
    },
    ...overrides,
  });
}

class MemoryDatabase implements ReaderDatabase {
  readonly values = new Map<IDBValidKey, unknown>();
  putAttempts = 0;
  quotaFailures = 0;

  async run<T>(_storeName: "translation-cache" | "catalog-cache", _mode: IDBTransactionMode, operation: (store: ReaderDbStore) => T | Promise<T>): Promise<T> {
    const store: ReaderDbStore = {
      get: async <V>(key: IDBValidKey) => this.values.get(key) as V | undefined,
      put: async (value: unknown) => {
        this.putAttempts += 1;
        if (this.quotaFailures > 0) {
          this.quotaFailures -= 1;
          throw new ReaderDatabaseError("QUOTA_EXCEEDED");
        }
        const key = (value as { cacheKey: string }).cacheKey;
        this.values.set(key, structuredClone(value));
        return key;
      },
      delete: async (key: IDBValidKey) => { this.values.delete(key); },
      clear: async () => { this.values.clear(); },
      iterateIndex: async <V>() => [...this.values.values()]
        .sort((left, right) => String((left as { accessedAt: string }).accessedAt).localeCompare(String((right as { accessedAt: string }).accessedAt))) as V[],
    };
    return operation(store);
  }

  close() {}
}

describe("translation cache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves paragraph IDs and order while only refreshing accessedAt on a hit", async () => {
    const database = new MemoryDatabase();
    let now = "2026-09-04T01:00:00.000Z";
    const cache = createTranslationCache({ database, now: () => now });
    const stored = await cache.put(completeInput());
    expect(stored.ok).toBe(true);

    const before = structuredClone(database.values.get(HASH_A));
    now = "2026-09-04T02:00:00.000Z";
    const hit = await cache.get(HASH_A);

    expect(hit?.translatedParagraphs).toEqual([{ id: "p1", text: "첫 문단" }, { id: "p2", text: "second" }]);
    expect(hit).toEqual({ ...(before as object), accessedAt: now });
  });

  it("computes deterministic UTF-8 serialized byte size instead of trusting a caller", async () => {
    const database = new MemoryDatabase();
    const cache = createTranslationCache({ database, now: () => "2026-09-04T01:00:00.000Z" });
    const result = await cache.put({ ...completeInput(), byteSize: 1 } as TranslationCachePutInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.record.byteSize).toBe(calculateTranslationRecordByteSize(result.record));
    expect(result.record.byteSize).toBe(new TextEncoder().encode(JSON.stringify(result.record)).byteLength);
  });

  it("finds an existing translation across settings and refreshes its access time", async () => {
    const database = new MemoryDatabase();
    let now = "2026-09-04T01:00:00.000Z";
    const cache = createTranslationCache({ database, now: () => now });
    await cache.put(completeInput());
    now = "2026-09-04T02:00:00.000Z";

    const hit = await cache.get("c".repeat(64), completeInput());

    expect(hit).toMatchObject({ cacheKey: HASH_A, accessedAt: now });
    expect(database.values.size).toBe(1);
    expect(await cache.get("c".repeat(64), completeInput({ contentHash: "d".repeat(64) }))).toBeUndefined();
    expect(await cache.get("c".repeat(64), completeInput({ canonicalUrl: "https://www.69shuba.com/txt/1/3" }))).toBeUndefined();
  });

  it("prefers a complete translation over partial records from other settings", async () => {
    const database = new MemoryDatabase();
    let now = "2026-09-04T01:00:00.000Z";
    const cache = createTranslationCache({ database, now: () => now });
    await cache.put(completeInput());
    now = "2026-09-04T02:00:00.000Z";
    await cache.put(completeInput({ cacheKey: "b".repeat(64) }));
    now = "2026-09-04T03:00:00.000Z";
    await cache.put(partialInput({ cacheKey: "c".repeat(64) }));

    expect(await cache.get("d".repeat(64), completeInput())).toMatchObject({ cacheKey: "b".repeat(64) });
    await cache.delete(HASH_A);
    await cache.delete("b".repeat(64));
    expect(await cache.get("d".repeat(64), completeInput())).toMatchObject({ kind: "partial" });
  });

  it("evicts only the least recently accessed records needed for the configured limit", async () => {
    const database = new MemoryDatabase();
    let now = "2026-09-04T01:00:00.000Z";
    const seedCache = createTranslationCache({ database, now: () => now, maxBytes: 10_000 });
    const oldest = await seedCache.put(completeInput({ cacheKey: "1".repeat(64) }));
    now = "2026-09-04T02:00:00.000Z";
    const recent = await seedCache.put(completeInput({ cacheKey: "2".repeat(64) }));
    expect(oldest.ok && recent.ok).toBe(true);
    if (!oldest.ok || !recent.ok) return;

    const nextSize = calculateTranslationRecordByteSize({
      ...recent.record,
      cacheKey: "3".repeat(64),
      createdAt: "2026-09-04T03:00:00.000Z",
      accessedAt: "2026-09-04T03:00:00.000Z",
    });
    const cache = createTranslationCache({ database, now: () => "2026-09-04T03:00:00.000Z", maxBytes: recent.record.byteSize + nextSize });
    await cache.put(completeInput({ cacheKey: "3".repeat(64) }));

    expect([...database.values.keys()]).toEqual(["2".repeat(64), "3".repeat(64)]);
  });

  it("cleans one extra LRU record and retries a quota failure exactly once", async () => {
    const database = new MemoryDatabase();
    const cache = createTranslationCache({ database, now: () => "2026-09-04T01:00:00.000Z" });
    await cache.put(completeInput({ cacheKey: "1".repeat(64) }));
    database.quotaFailures = 1;

    const result = await cache.put(completeInput({ cacheKey: "2".repeat(64) }));
    expect(result.ok).toBe(true);
    expect(database.putAttempts).toBe(3);
    expect(database.values.has("1".repeat(64))).toBe(false);
  });

  it("returns STORAGE_FULL after one retry without mutating the completed translation input", async () => {
    const database = new MemoryDatabase();
    database.quotaFailures = 2;
    const input = completeInput();
    const original = structuredClone(input);
    const result = await createTranslationCache({ database, now: () => "2026-09-04T01:00:00.000Z" }).put(input);

    expect(result).toMatchObject({ ok: false, error: { code: "STORAGE_FULL" } });
    expect(database.putAttempts).toBe(2);
    expect(input).toEqual(original);
  });

  it("stores partial progress separately without execution-local chunk IDs or secret-like fields", async () => {
    const database = new MemoryDatabase();
    const cache = createTranslationCache({ database, now: () => "2026-09-04T01:00:00.000Z" });

    const partialWithSecrets = { ...partialInput(), apiKey: "secret", userPrompt: "raw prompt" };
    const partialResult = await cache.put(partialWithSecrets);
    expect(partialResult).toMatchObject({
      ok: true,
      record: {
        kind: "partial",
        progressStatus: "partial_failure",
        translatedParagraphs: [{ id: "p1", text: "완료" }],
        totalParagraphs: 2,
        unfinishedParagraphIds: ["p2"],
        failedParagraphIds: ["p2"],
      },
    });
    if (!partialResult.ok) return;
    expect(isCompleteTranslationCacheRecord(partialResult.record)).toBe(false);
    expect(partialResult.record.byteSize).toBe(calculateTranslationRecordByteSize(partialResult.record));
    expect(JSON.stringify(partialResult.record)).not.toContain("chunk-2");

    const inputWithSecrets = { ...completeInput(), apiKey: "secret", userPrompt: "raw prompt" };
    const result = await cache.put(inputWithSecrets);
    expect(result.ok).toBe(true);
    expect(JSON.stringify([...database.values.values()])).not.toContain("secret");
    expect(JSON.stringify([...database.values.values()])).not.toContain("raw prompt");
  });

  it("reads legacy complete records as complete while preserving their stored shape", async () => {
    const database = new MemoryDatabase();
    const cache = createTranslationCache({ database, now: () => "2026-09-04T02:00:00.000Z" });
    const stored = await cache.put(completeInput());
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    const legacy = { ...stored.record };
    delete legacy.kind;
    database.values.set(HASH_A, legacy);

    const hit = await cache.get(HASH_A);

    expect(hit).toEqual({ ...legacy, accessedAt: "2026-09-04T02:00:00.000Z" });
    expect(hit && isCompleteTranslationCacheRecord(hit)).toBe(true);
  });

  it("applies byte limits and LRU eviction across complete and partial records", async () => {
    const database = new MemoryDatabase();
    let now = "2026-09-04T01:00:00.000Z";
    const seed = createTranslationCache({ database, now: () => now, maxBytes: 10_000 });
    const complete = await seed.put(completeInput({ cacheKey: "1".repeat(64) }));
    now = "2026-09-04T02:00:00.000Z";
    const partial = await seed.put(partialInput({ cacheKey: "2".repeat(64) }));
    expect(complete.ok && partial.ok).toBe(true);
    if (!complete.ok || !partial.ok) return;

    const nextSize = calculateTranslationRecordByteSize({
      ...partial.record,
      cacheKey: "3".repeat(64),
      createdAt: "2026-09-04T03:00:00.000Z",
      accessedAt: "2026-09-04T03:00:00.000Z",
    });
    const limited = createTranslationCache({
      database,
      now: () => "2026-09-04T03:00:00.000Z",
      maxBytes: partial.record.byteSize + nextSize,
    });
    await limited.put(partialInput({ cacheKey: "3".repeat(64) }));

    expect([...database.values.keys()]).toEqual(["2".repeat(64), "3".repeat(64)]);
  });

  it("coalesces progress writes and explicitly flushes terminal progress", async () => {
    vi.useFakeTimers();
    const database = new MemoryDatabase();
    const cache = createTranslationCache({ database, now: () => "2026-09-04T01:00:00.000Z" });
    const scheduler = createTranslationCacheWriteScheduler({
      cache,
      record: {
        cacheKey: HASH_A,
        canonicalUrl: "https://www.69shuba.com/txt/1/2",
        contentHash: HASH_B,
        modelId: "gemini-test",
        targetLanguage: "ko",
        basePromptVersion: "v1",
        userPromptHash: HASH_A,
      },
      delayMs: 100,
    });

    scheduler.schedule(partialInput().progress);
    scheduler.schedule({
      status: "translating",
      completedParagraphs: 2,
      totalParagraphs: 3,
      translations: [{ id: "p1", text: "완료" }, { id: "p2", text: "완료 2" }],
      failedChunkIds: [],
      unfinishedParagraphIds: ["p3"],
      failedParagraphIds: [],
    });
    expect(database.putAttempts).toBe(0);

    await vi.advanceTimersByTimeAsync(100);
    expect(database.putAttempts).toBe(1);
    expect(database.values.get(HASH_A)).toMatchObject({
      kind: "partial",
      translatedParagraphs: [{ id: "p1" }, { id: "p2" }],
      unfinishedParagraphIds: ["p3"],
    });

    scheduler.schedule({
      status: "cancelled",
      completedParagraphs: 2,
      totalParagraphs: 3,
      translations: [{ id: "p1", text: "완료" }, { id: "p2", text: "완료 2" }],
      failedChunkIds: [],
      unfinishedParagraphIds: ["p3"],
      failedParagraphIds: [],
    });
    const flushed = await scheduler.flush();

    expect(flushed).toMatchObject({ ok: true, record: { progressStatus: "cancelled" } });
    expect(database.putAttempts).toBe(2);
    await vi.runAllTimersAsync();
    expect(database.putAttempts).toBe(2);
  });

  it("validates DB output and supports delete and translation-only clear", async () => {
    const database = new MemoryDatabase();
    const cache = createTranslationCache({ database, now: () => "2026-09-04T01:00:00.000Z" });
    await cache.put(completeInput({ cacheKey: "1".repeat(64) }));
    await cache.put(completeInput({ cacheKey: "2".repeat(64) }));
    await cache.delete("1".repeat(64));
    expect(database.values.has("1".repeat(64))).toBe(false);
    await cache.clear();
    expect(database.values.size).toBe(0);

    database.values.set(HASH_A, { cacheKey: HASH_A, invalid: true });
    await expect(cache.get(HASH_A)).rejects.toThrow();
  });
});
