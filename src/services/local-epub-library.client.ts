import "client-only";

import { publicErrorForCode, type PublicError } from "../lib/errors";
import { createLocalEpubLocator } from "../lib/epub/locator.client";
import {
  LocalEpubBookSchema,
  LocalEpubCatalogSchema,
  LocalEpubChapterSchema,
  type LocalEpubBook,
} from "../types/epub";
import { LocalEpubArchiveRecordSchema, type LocalEpubArchiveRecord } from "../types/storage";
import type { CatalogSource, ChapterSource } from "../types/source";
import { READER_DB_SCHEMA, type ReaderDatabase } from "./reader-db.client";
import type { SourceCacheLookup } from "./source-cache.client";

type StorageManager = {
  estimate(): Promise<{ usage?: number; quota?: number }>;
  persist(): Promise<boolean>;
};

type LocalSourceCache = {
  get(canonicalUrl: string): Promise<SourceCacheLookup>;
  put(chapter: ChapterSource): Promise<{ status: "stored" | "unavailable" }>;
};

type LocalCatalogCache = {
  put(catalog: CatalogSource): Promise<unknown>;
};

export type LocalEpubImport = {
  archive: Blob;
  book: LocalEpubBook;
  chapters: ChapterSource[];
  catalog: CatalogSource;
};

export type LocalEpubImportResult =
  | { ok: true; book: LocalEpubBook }
  | { ok: false; error: PublicError };

export type LocalEpubLibrary = {
  import(input: LocalEpubImport): Promise<LocalEpubImportResult>;
  getBook(bookId: string): Promise<LocalEpubBook | undefined>;
  getArchive(bookId: string): Promise<Blob | undefined>;
  openChapter(bookId: string, index: number): Promise<SourceCacheLookup>;
};

type LocalEpubLibraryOptions = {
  database: ReaderDatabase;
  sourceCache: LocalSourceCache;
  catalogCache: LocalCatalogCache;
  storage?: StorageManager;
};

const storageFullError = publicErrorForCode("STORAGE_FULL");

function validBookId(bookId: string): boolean {
  return /^[a-f0-9]{64}$/i.test(bookId);
}

function validateImport(input: LocalEpubImport): { book: LocalEpubBook; chapters: ChapterSource[]; catalog: CatalogSource } {
  if (typeof Blob === "undefined" || !(input.archive instanceof Blob)) throw new TypeError("Invalid EPUB archive");
  const book = LocalEpubBookSchema.parse(input.book);
  if (book.sourceByteSize !== input.archive.size) throw new TypeError("Archive size does not match metadata");
  if (book.chapters.some((chapter, index) => chapter.index !== index || chapter.canonicalUrl !== createLocalEpubLocator(book.id, index))) {
    throw new TypeError("EPUB chapter metadata must be ordered locators");
  }
  if (input.chapters.length !== book.chapters.length) throw new TypeError("EPUB chapter metadata does not match content");
  const chapters = input.chapters.map((chapter, index) => {
    const parsed = LocalEpubChapterSchema.parse(chapter);
    const metadata = book.chapters[index];
    if (
      parsed.bookId !== book.id
      || parsed.canonicalUrl !== metadata.canonicalUrl
      || parsed.chapterTitle !== metadata.title
    ) throw new TypeError("EPUB chapter does not match metadata");
    return parsed;
  });
  const catalog = LocalEpubCatalogSchema.parse(input.catalog);
  if (catalog.bookId !== book.id) throw new TypeError("EPUB catalog does not match metadata");
  return { book, chapters, catalog };
}

export function createLocalEpubLibrary({
  database,
  sourceCache,
  catalogCache,
  storage = globalThis.navigator?.storage,
}: LocalEpubLibraryOptions): LocalEpubLibrary {
  const bookStore = READER_DB_SCHEMA.stores.epubBooks.name;
  const archiveStore = READER_DB_SCHEMA.stores.epubArchives.name;

  return {
    async import(input) {
      let parsed: ReturnType<typeof validateImport>;
      try {
        parsed = validateImport(input);
        const estimate = storage ? await storage.estimate() : undefined;
        if (
          typeof estimate?.usage === "number"
          && typeof estimate.quota === "number"
          && estimate.usage + input.archive.size > estimate.quota
        ) return { ok: false, error: storageFullError };
        await storage?.persist();
      } catch {
        return { ok: false, error: storageFullError };
      }

      try {
        const archive: LocalEpubArchiveRecord = LocalEpubArchiveRecordSchema.parse({
          bookId: parsed.book.id,
          archive: input.archive,
        });
        for (const chapter of parsed.chapters) {
          const stored = await sourceCache.put(chapter);
          if (stored.status !== "stored") return { ok: false, error: storageFullError };
        }
        await catalogCache.put(parsed.catalog);
        await database.run(archiveStore, "readwrite", (store) => store.put(archive));
        await database.run(bookStore, "readwrite", (store) => store.put(parsed.book));
        return { ok: true, book: parsed.book };
      } catch {
        return { ok: false, error: storageFullError };
      }
    },

    async getBook(bookId) {
      if (!validBookId(bookId)) return undefined;
      try {
        const value = await database.run(bookStore, "readonly", (store) => store.get<unknown>(bookId));
        const parsed = LocalEpubBookSchema.safeParse(value);
        return parsed.success && parsed.data.id === bookId ? parsed.data : undefined;
      } catch {
        return undefined;
      }
    },

    async getArchive(bookId) {
      if (!validBookId(bookId)) return undefined;
      try {
        const value = await database.run(archiveStore, "readonly", (store) => store.get<unknown>(bookId));
        const parsed = LocalEpubArchiveRecordSchema.safeParse(value);
        return parsed.success && parsed.data.bookId === bookId ? parsed.data.archive : undefined;
      } catch {
        return undefined;
      }
    },

    async openChapter(bookId, index) {
      if (!validBookId(bookId) || !Number.isSafeInteger(index) || index < 0) return { status: "miss" };
      const locator = createLocalEpubLocator(bookId, index);
      const result = await sourceCache.get(locator);
      if (result.status !== "hit") return result;
      const parsed = LocalEpubChapterSchema.safeParse(result.chapter);
      return parsed.success && parsed.data.bookId === bookId && parsed.data.canonicalUrl === locator
        ? { status: "hit", chapter: parsed.data }
        : { status: "miss" };
    },
  };
}
