import { describe, expect, it, vi } from "vitest";

import { createLocalEpubLocator } from "../../src/lib/epub/locator.client";
import { createLocalEpubLibrary } from "../../src/services/local-epub-library.client";
import type { ReaderDatabase, ReaderDbStore, ReaderDbStoreName } from "../../src/services/reader-db.client";
import type { ChapterSource } from "../../src/types/source";
import type { LocalEpubBook } from "../../src/types/epub";

const BOOK_ID = "a".repeat(64);
const IMPORTED_AT = "2026-09-05T00:00:00.000Z";
const LOCATOR = createLocalEpubLocator(BOOK_ID, 0);

class MemoryDatabase implements ReaderDatabase {
  readonly values = new Map<ReaderDbStoreName, Map<IDBValidKey, unknown>>();

  async run<T>(storeName: ReaderDbStoreName, _mode: IDBTransactionMode, operation: (store: ReaderDbStore) => T | Promise<T>): Promise<T> {
    const values = this.values.get(storeName) ?? new Map<IDBValidKey, unknown>();
    this.values.set(storeName, values);
    return operation({
      get: async <V>(key: IDBValidKey) => values.get(key) as V | undefined,
      put: async (value) => {
        const record = value as { id?: string; bookId?: string; canonicalUrl?: string };
        const key = record.id ?? record.bookId ?? record.canonicalUrl;
        if (!key) throw new Error("missing key");
        values.set(key, value);
        return key;
      },
      delete: async (key) => { values.delete(key); },
      clear: async () => { values.clear(); },
      iterateIndex: async <V>() => [...values.values()] as V[],
    });
  }

  close() {}
}

function chapter(): ChapterSource {
  return {
    kind: "chapter", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
    bookTitle: "Synthetic book", chapterId: "chapter-0", chapterNumber: 1, chapterTitle: "First chapter",
    paragraphs: [{ id: "paragraph-1", text: "local text" }], navigation: {}, contentHash: "b".repeat(64), fetchedAt: IMPORTED_AT,
  };
}

function book(): LocalEpubBook {
  return {
    id: BOOK_ID, title: "Synthetic book", sourceByteSize: 5, importedAt: IMPORTED_AT,
    chapters: [{ index: 0, canonicalUrl: LOCATOR, title: "First chapter" }],
  };
}

describe("local EPUB library", () => {
  it("stores metadata and archive independently, then reopens a source-cache chapter", async () => {
    const database = new MemoryDatabase();
    const sourceCache = {
      put: vi.fn(async () => ({ status: "stored" as const })),
      get: vi.fn(async () => ({ status: "hit" as const, chapter: chapter() })),
    };
    const catalogCache = { put: vi.fn(async () => undefined) };
    const persist = vi.fn(async () => true);
    const library = createLocalEpubLibrary({
      database, sourceCache, catalogCache,
      storage: { estimate: async () => ({ usage: 10, quota: 100 }), persist },
    });
    const archive = new Blob(["epub!"], { type: "application/epub+zip" });

    await expect(library.import({ archive, book: book(), chapters: [chapter()], catalog: {
      kind: "catalog", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
      bookTitle: "Synthetic book", chapters: [{ id: "chapter-0", url: LOCATOR, title: "First chapter", sourceIndex: 0 }], fetchedAt: IMPORTED_AT,
    } })).resolves.toEqual({ ok: true, book: book() });

    expect(database.values.get("local-epub-books")?.get(BOOK_ID)).toEqual(book());
    expect(database.values.get("local-epub-archives")?.get(BOOK_ID)).toMatchObject({ bookId: BOOK_ID, archive });
    expect(sourceCache.put).toHaveBeenCalledWith(chapter());
    expect(persist).toHaveBeenCalledOnce();
    await expect(library.openChapter(BOOK_ID, 0)).resolves.toEqual({ status: "hit", chapter: chapter() });
  });

  it("fails before writing or deleting books when the archive does not fit", async () => {
    const database = new MemoryDatabase();
    const sourceCache = { put: vi.fn(), get: vi.fn() };
    const library = createLocalEpubLibrary({
      database, sourceCache, catalogCache: { put: vi.fn() },
      storage: { estimate: async () => ({ usage: 98, quota: 100 }), persist: async () => false },
    });

    await expect(library.import({ archive: new Blob(["epub!"], { type: "application/epub+zip" }), book: book(), chapters: [chapter()], catalog: {
      kind: "catalog", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
      bookTitle: "Synthetic book", chapters: [{ id: "chapter-0", url: LOCATOR, title: "First chapter", sourceIndex: 0 }], fetchedAt: IMPORTED_AT,
    } })).resolves.toEqual({ ok: false, error: expect.objectContaining({ code: "STORAGE_FULL" }) });

    expect(database.values.size).toBe(0);
    expect(sourceCache.put).not.toHaveBeenCalled();
  });
});
