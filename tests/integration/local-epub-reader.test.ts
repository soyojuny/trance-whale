import { describe, expect, it, vi } from "vitest";

import { createLocalEpubLocator } from "../../src/lib/epub/locator.client";
import { createReaderSessionController } from "../../src/lib/reader/session.client";
import type { ReaderDatabase, ReaderDbStore, ReaderDbStoreName } from "../../src/services/reader-db.client";
import { createSourceCache } from "../../src/services/source-cache.client";
import type { ChapterSource } from "../../src/types/source";

const BOOK_ID = "a".repeat(64);
const IMPORTED_AT = "2026-09-05T00:00:00.000Z";
const LOCATOR = createLocalEpubLocator(BOOK_ID, 0);

class MemoryDatabase implements ReaderDatabase {
  readonly records = new Map<ReaderDbStoreName, Map<IDBValidKey, unknown>>();

  async run<T>(storeName: ReaderDbStoreName, _mode: IDBTransactionMode, operation: (store: ReaderDbStore) => T | Promise<T>): Promise<T> {
    const records = this.records.get(storeName) ?? new Map<IDBValidKey, unknown>();
    this.records.set(storeName, records);
    return operation({
      get: async <V>(key: IDBValidKey) => records.get(key) as V | undefined,
      put: async (value) => {
        const record = value as { id?: string; bookId?: string; canonicalUrl?: string; cacheKey?: string };
        const key = record.id ?? record.bookId ?? record.canonicalUrl ?? record.cacheKey;
        if (!key) throw new Error("record key required");
        records.set(key, value);
        return key;
      },
      delete: async (key) => { records.delete(key); },
      clear: async () => { records.clear(); },
      iterateIndex: async <V>() => [...records.values()] as V[],
    });
  }

  close() {}
}

const chapter: ChapterSource = {
  kind: "chapter", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
  bookTitle: "Synthetic book", chapterId: "chapter-0", chapterNumber: 1, chapterTitle: "First chapter",
  paragraphs: [{ id: "paragraph-1", text: "local text" }], navigation: {}, contentHash: "b".repeat(64), fetchedAt: IMPORTED_AT,
};

describe("local EPUB reader integration", () => {
  it("opens an extracted local chapter offline without calling the source API or Gemini", async () => {
    const database = new MemoryDatabase();
    const sourceCache = createSourceCache({ database, now: () => IMPORTED_AT });
    const openChapter = vi.fn(async () => ({ status: "hit" as const, chapter }));

    const fetchChapter = vi.fn();
    const execute = vi.fn();
    const controller = createReaderSessionController({
      sourceClient: { fetchChapter, fetchCatalog: vi.fn() },
      sourceCache,
      localEpubLibrary: { openChapter },
      networkAvailable: () => false,
      preparePipeline: async () => ({
        cacheKey: "cache-key",
        getCached: async () => ({
          cache: "hit", persistence: { status: "not_attempted" }, errors: [],
          progress: {
            status: "complete", completedParagraphs: 1, totalParagraphs: 1,
            translations: [{ id: "paragraph-1", text: "번역" }], failedChunkIds: [],
          },
        }),
        execute,
      }),
      loadTranslationSettings: () => ({ apiKey: "", userPrompt: "", translationMode: "fast" }),
    });

    await controller.openLocalChapter(BOOK_ID, 0);

    expect(fetchChapter).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(openChapter).toHaveBeenCalledWith(BOOK_ID, 0);
    expect(controller.getState()).toMatchObject({ status: "complete", chapter });
  });
});
