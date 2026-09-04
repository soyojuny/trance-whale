import { describe, expect, it } from "vitest";

import {
  CATALOG_CACHE_TTL_MS,
  createCatalogCache,
} from "../../src/services/catalog-cache.client";
import type { ReaderDatabase, ReaderDbStore } from "../../src/services/reader-db.client";
import type { CatalogSource } from "../../src/types/source";

const CATALOG_URL = "https://www.69shuba.com/book/48273/";
const CREATED_AT = "2026-09-04T01:00:00.000Z";

function catalog(chapterCount = 2): CatalogSource {
  return {
    kind: "catalog",
    sourceUrl: CATALOG_URL,
    canonicalUrl: CATALOG_URL,
    siteId: "69shuba",
    bookId: "48273",
    bookTitle: "示例作品",
    chapters: Array.from({ length: chapterCount }, (_, sourceIndex) => ({
      id: `chapter-${sourceIndex + 1}`,
      url: `https://www.69shuba.com/txt/48273/${32028706 + sourceIndex}`,
      title: `第${sourceIndex + 1}章 原文标题`,
      number: sourceIndex + 1,
      sourceIndex,
    })),
    fetchedAt: CREATED_AT,
  };
}

class MemoryDatabase implements ReaderDatabase {
  readonly values = new Map<IDBValidKey, unknown>();

  async run<T>(
    _storeName: "translation-cache" | "catalog-cache",
    _mode: IDBTransactionMode,
    operation: (store: ReaderDbStore) => T | Promise<T>,
  ): Promise<T> {
    const store: ReaderDbStore = {
      get: async <V>(key: IDBValidKey) => structuredClone(this.values.get(key)) as V | undefined,
      put: async (value: unknown) => {
        const key = (value as { canonicalUrl: string }).canonicalUrl;
        this.values.set(key, structuredClone(value));
        return key;
      },
      delete: async (key: IDBValidKey) => {
        this.values.delete(key);
      },
      clear: async () => {
        this.values.clear();
      },
      iterateIndex: async <V>() => [...this.values.values()] as V[],
    };
    return operation(store);
  }

  close() {}
}

describe("catalog cache", () => {
  it("returns fresh only before the exact 24-hour expiry boundary", async () => {
    const database = new MemoryDatabase();
    let now = CREATED_AT;
    const cache = createCatalogCache({ database, now: () => now });
    const record = await cache.put(catalog());

    now = new Date(Date.parse(CREATED_AT) + CATALOG_CACHE_TTL_MS - 1).toISOString();
    expect(await cache.get(CATALOG_URL)).toMatchObject({ status: "fresh" });

    now = record.expiresAt;
    expect(await cache.get(CATALOG_URL)).toEqual({ status: "stale", record: { ...record, accessedAt: new Date(Date.parse(record.expiresAt) - 1).toISOString() } });

    now = new Date(Date.parse(record.expiresAt) + 1).toISOString();
    expect(await cache.get(CATALOG_URL)).toMatchObject({ status: "stale" });
  });

  it("refreshes only accessedAt on fresh hits without extending the TTL", async () => {
    const database = new MemoryDatabase();
    let now = CREATED_AT;
    const cache = createCatalogCache({ database, now: () => now });
    const created = await cache.put(catalog());

    now = "2026-09-04T12:00:00.000Z";
    const hit = await cache.get(CATALOG_URL);
    expect(hit).toEqual({ status: "fresh", record: { ...created, accessedAt: now } });
    expect(database.values.get(CATALOG_URL)).toEqual({ ...created, accessedAt: now });
  });

  it("preserves more than 2,000 chapters without truncation or reordering", async () => {
    const database = new MemoryDatabase();
    const cache = createCatalogCache({ database, now: () => CREATED_AT });
    const source = catalog(2_001);
    await cache.put(source);

    const hit = await cache.get(CATALOG_URL);
    expect(hit.status).toBe("fresh");
    if (hit.status !== "fresh") return;
    expect(hit.record.catalog.chapters).toEqual(source.chapters);
  });

  it("treats malformed database values as misses and never fetches on stale reads", async () => {
    const database = new MemoryDatabase();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      throw new Error("network must not be called");
    }) as typeof fetch;

    try {
      database.values.set(CATALOG_URL, { canonicalUrl: CATALOG_URL, invalid: true });
      const cache = createCatalogCache({ database, now: () => CREATED_AT });
      expect(await cache.get(CATALOG_URL)).toEqual({ status: "miss" });

      await cache.put(catalog());
      const staleCache = createCatalogCache({
        database,
        now: () => new Date(Date.parse(CREATED_AT) + CATALOG_CACHE_TTL_MS).toISOString(),
      });
      expect(await staleCache.get(CATALOG_URL)).toMatchObject({ status: "stale" });
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("validates input and supports delete and catalog-only clear", async () => {
    const database = new MemoryDatabase();
    const cache = createCatalogCache({ database, now: () => CREATED_AT });

    await expect(cache.put({ ...catalog(), chapters: [] })).rejects.toThrow();
    await cache.put(catalog());
    await cache.delete(CATALOG_URL);
    expect(await cache.get(CATALOG_URL)).toEqual({ status: "miss" });

    await cache.put(catalog());
    await cache.clear();
    expect(database.values.size).toBe(0);
  });
});
