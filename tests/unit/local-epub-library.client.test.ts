import { describe, expect, it, vi } from "vitest";

import { createLocalEpubLocator } from "../../src/lib/epub/locator.client";
import { createLocalEpubLibrary } from "../../src/services/local-epub-library.client";
import type { ReaderDatabase, ReaderDbStore, ReaderDbStoreName } from "../../src/services/reader-db.client";
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

function book(): LocalEpubBook {
  return {
    id: BOOK_ID, title: "Synthetic book", sourceByteSize: 5, importedAt: IMPORTED_AT,
    chapters: [{ index: 0, canonicalUrl: LOCATOR, title: "First chapter" }],
  };
}

function epubArchive(): Blob {
  const bytes = new TextEncoder().encode("epub!");
  const archive = new Blob([bytes], { type: "application/epub+zip" });
  Object.defineProperty(archive, "arrayBuffer", {
    value: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  return archive;
}

describe("local EPUB library", () => {
  it("stores metadata, archive, and chapter paths without persisting source chapters", async () => {
    const database = new MemoryDatabase();
    const catalogCache = { put: vi.fn(async () => undefined) };
    const persist = vi.fn(async () => true);
    const library = createLocalEpubLibrary({
      database, catalogCache,
      storage: { estimate: async () => ({ usage: 10, quota: 10_000 }), persist },
    });
    const archive = epubArchive();

    await expect(library.import({ archive, book: book(), chapterPaths: ["OPS/text/chapter-1.xhtml"], catalog: {
      kind: "catalog", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
      bookTitle: "Synthetic book", chapters: [{ id: "chapter-0", url: LOCATOR, title: "First chapter", sourceIndex: 0 }], fetchedAt: IMPORTED_AT,
    } })).resolves.toEqual({ ok: true, book: book() });

    expect(database.values.get("local-epub-books")?.get(BOOK_ID)).toEqual(book());
    expect(database.values.get("local-epub-archives")?.get(BOOK_ID)).toEqual({
      bookId: BOOK_ID, byteSize: archive.size, chunkCount: 1, chapterPaths: ["OPS/text/chapter-1.xhtml"],
    });
    expect(database.values.get("local-epub-archive-chunks")?.get(`${BOOK_ID}:0`)).toMatchObject({
      bookId: BOOK_ID, index: 0, encodedBytes: expect.any(String),
    });
    expect((await library.getArchive(BOOK_ID))?.size).toBe(archive.size);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("fails before writing or deleting books when the archive does not fit", async () => {
    const database = new MemoryDatabase();
    const library = createLocalEpubLibrary({
      database, catalogCache: { put: vi.fn() },
      storage: { estimate: async () => ({ usage: 98, quota: 100 }), persist: async () => false },
    });

    const result = await library.import({ archive: epubArchive(), book: book(), chapterPaths: ["OPS/text/chapter-1.xhtml"], catalog: {
      kind: "catalog", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
      bookTitle: "Synthetic book", chapters: [{ id: "chapter-0", url: LOCATOR, title: "First chapter", sourceIndex: 0 }], fetchedAt: IMPORTED_AT,
    } });

    expect(result).toMatchObject({ ok: false, error: { code: "STORAGE_FULL", message: expect.stringContaining("필요한 공간") } });

    expect(database.values.size).toBe(0);
  });

  it("continues importing when storage estimation or persistence requests are unavailable", async () => {
    const database = new MemoryDatabase();
    const library = createLocalEpubLibrary({
      database,
      catalogCache: { put: vi.fn(async () => undefined) },
      storage: {
        estimate: vi.fn(async () => { throw new Error("unsupported"); }),
        persist: vi.fn(async () => { throw new Error("denied"); }),
      },
    });

    await expect(library.import({ archive: epubArchive(), book: book(), chapterPaths: ["OPS/text/chapter-1.xhtml"], catalog: {
      kind: "catalog", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
      bookTitle: "Synthetic book", chapters: [{ id: "chapter-0", url: LOCATOR, title: "First chapter", sourceIndex: 0 }], fetchedAt: IMPORTED_AT,
    } })).resolves.toEqual({ ok: true, book: book() });
  });

  it("identifies the failed local storage record without exposing the exception", async () => {
    const database = new MemoryDatabase();
    const library = createLocalEpubLibrary({
      database,
      catalogCache: { put: vi.fn(async () => { throw new Error("private detail"); }) },
      storage: { estimate: async () => ({ usage: 0, quota: 10_000 }), persist: async () => true },
    });

    const result = await library.import({ archive: epubArchive(), book: book(), chapterPaths: ["OPS/text/chapter-1.xhtml"], catalog: {
      kind: "catalog", sourceUrl: LOCATOR, canonicalUrl: LOCATOR, siteId: "local-epub", bookId: BOOK_ID,
      bookTitle: "Synthetic book", chapters: [{ id: "chapter-0", url: LOCATOR, title: "First chapter", sourceIndex: 0 }], fetchedAt: IMPORTED_AT,
    } });

    expect(result).toMatchObject({ ok: false, error: { code: "STORAGE_FULL", message: expect.stringContaining("목차") } });
    expect(JSON.stringify(result)).not.toContain("private detail");
  });
});
