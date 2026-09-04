import { describe, expect, it } from "vitest";

import {
  createSourceCache,
  type SourceCacheLookup,
} from "../../src/services/source-cache.client";
import {
  ReaderDatabaseError,
  type ReaderDatabase,
  type ReaderDbStore,
} from "../../src/services/reader-db.client";
import type { ChapterSource } from "../../src/types/source";

const CHAPTER_URL = "https://www.69shuba.com/txt/48273/32028706";
const CREATED_AT = "2026-09-04T01:00:00.000Z";

function chapter(): ChapterSource {
  return {
    kind: "chapter",
    sourceUrl: CHAPTER_URL,
    canonicalUrl: CHAPTER_URL,
    siteId: "69shuba",
    bookId: "48273",
    bookTitle: "示例作品",
    chapterId: "32028706",
    chapterNumber: 1,
    chapterTitle: "第1章 原文标题",
    paragraphs: [
      { id: "p-1", text: "첫 번째 원문 문단" },
      { id: "p-2", text: "두 번째 원문 문단" },
    ],
    navigation: {
      previous: { url: "https://www.69shuba.com/txt/48273/32028705", label: "이전 장" },
      catalog: { url: "https://www.69shuba.com/book/48273/", label: "목차" },
      next: { url: "https://www.69shuba.com/txt/48273/32028707", label: "다음 장" },
    },
    contentHash: "a".repeat(64),
    fetchedAt: CREATED_AT,
  };
}

class MemoryDatabase implements ReaderDatabase {
  readonly values = new Map<string, Map<IDBValidKey, unknown>>();
  failure: ReaderDatabaseError | null = null;

  async run<T>(
    storeName: "translation-cache" | "catalog-cache" | "source-cache",
    _mode: IDBTransactionMode,
    operation: (store: ReaderDbStore) => T | Promise<T>,
  ): Promise<T> {
    if (this.failure) throw this.failure;
    const values = this.values.get(storeName) ?? new Map<IDBValidKey, unknown>();
    this.values.set(storeName, values);
    const store: ReaderDbStore = {
      get: async <V>(key: IDBValidKey) => structuredClone(values.get(key)) as V | undefined,
      put: async (value: unknown) => {
        const key = (value as { canonicalUrl: string }).canonicalUrl;
        values.set(key, structuredClone(value));
        return key;
      },
      delete: async (key: IDBValidKey) => { values.delete(key); },
      clear: async () => { values.clear(); },
      iterateIndex: async <V>() => [...values.values()] as V[],
    };
    return operation(store);
  }

  close() {}
}

describe("source cache", () => {
  it("restores a complete chapter source and its navigation by canonical URL", async () => {
    const database = new MemoryDatabase();
    const cache = createSourceCache({ database, now: () => CREATED_AT });
    const source = chapter();

    const stored = await cache.put(source);
    const hit = await cache.get(CHAPTER_URL);

    expect(stored).toEqual({
      status: "stored",
      record: { canonicalUrl: CHAPTER_URL, createdAt: CREATED_AT, chapter: source },
    });
    expect(hit).toEqual<SourceCacheLookup>({ status: "hit", chapter: source });
  });

  it("treats corrupt records as misses and rejects settings or translation fields", async () => {
    const database = new MemoryDatabase();
    const cache = createSourceCache({ database, now: () => CREATED_AT });
    const source = chapter();
    const records = new Map<IDBValidKey, unknown>();
    database.values.set("source-cache", records);
    records.set(CHAPTER_URL, {
      canonicalUrl: CHAPTER_URL,
      createdAt: CREATED_AT,
      chapter: { ...source, paragraphs: [] },
    });

    expect(await cache.get(CHAPTER_URL)).toEqual({ status: "miss" });

    await cache.put(source);
    const accidentalSecretResult = await cache.put({
      ...source,
      apiKey: "not-for-storage",
      userPrompt: "not-for-storage",
      translatedParagraphs: [{ id: "p-1", text: "not-for-storage" }],
    } as ChapterSource);
    const serialized = JSON.stringify([...records.values()]);
    expect(accidentalSecretResult).toEqual({ status: "unavailable" });
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("userPrompt");
    expect(serialized).not.toContain("translatedParagraphs");
    expect(serialized).not.toContain("geminiResponse");
    expect(serialized).not.toContain("not-for-storage");
  });

  it("returns safe unavailable results when IndexedDB operations fail", async () => {
    const database = new MemoryDatabase();
    database.failure = new ReaderDatabaseError("REQUEST_FAILED");
    const cache = createSourceCache({ database, now: () => CREATED_AT });
    const source = chapter();

    const getResult = await cache.get(CHAPTER_URL);
    const putResult = await cache.put(source);

    expect(getResult).toEqual({ status: "unavailable" });
    expect(putResult).toEqual({ status: "unavailable" });
    expect(JSON.stringify({ getResult, putResult })).not.toContain(source.chapterTitle);
    expect(JSON.stringify({ getResult, putResult })).not.toContain(source.paragraphs[0].text);
  });
});
