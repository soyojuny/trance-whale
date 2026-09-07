import "client-only";

import { publicErrorForCode, type PublicError } from "../lib/errors";
import { createLocalEpubLocator } from "../lib/epub/locator.client";
import { parseStoredEpubChapter } from "../lib/epub/parse-epub.client";
import {
  LocalEpubBookSchema,
  LocalEpubCatalogSchema,
  type LocalEpubBook,
} from "../types/epub";
import {
  LocalEpubArchiveChunkRecordSchema,
  LocalEpubArchiveRecordSchema,
  type LocalEpubArchiveChunkRecord,
  type LocalEpubArchiveRecord,
} from "../types/storage";
import type { CatalogSource } from "../types/source";
import { READER_DB_SCHEMA, ReaderDatabaseError, type ReaderDatabase } from "./reader-db.client";
import type { SourceCacheLookup } from "./source-cache.client";

type StorageManager = {
  estimate?(): Promise<{ usage?: number; quota?: number }>;
  persist?(): Promise<boolean>;
};

type LocalCatalogCache = {
  put(catalog: CatalogSource): Promise<unknown>;
};

export type LocalEpubImport = {
  archive: Blob;
  book: LocalEpubBook;
  catalog: CatalogSource;
  chapterPaths: string[];
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
  catalogCache: LocalCatalogCache;
  storage?: StorageManager;
};

const storageFullError = publicErrorForCode("STORAGE_FULL");
const MEBIBYTE = 1024 * 1024;
const ARCHIVE_CHUNK_BYTES = 256 * 1024;

function formatStorageSize(bytes: number): string {
  return `${(Math.ceil((Math.max(0, bytes) / MEBIBYTE) * 10) / 10).toFixed(1)} MB`;
}

function storageFullDiagnostic(requiredBytes: number, estimate: { usage?: number; quota?: number } | undefined): PublicError {
  if (typeof estimate?.usage !== "number" || typeof estimate.quota !== "number") return storageFullError;
  const availableBytes = estimate.quota - estimate.usage;
  return {
    ...storageFullError,
    message: `브라우저 저장 공간이 부족합니다. 필요한 공간: 약 ${formatStorageSize(requiredBytes)}, 사용 가능: 약 ${formatStorageSize(availableBytes)}.`,
  };
}

async function storageWriteDiagnostic(
  storage: StorageManager | undefined,
  requiredBytes: number,
  recordLabel: string,
  failure?: unknown,
): Promise<PublicError> {
  let estimate: { usage?: number; quota?: number } | undefined;
  try {
    estimate = await storage?.estimate?.();
  } catch {
    // Preserve the generic public error when the browser cannot expose quota details.
  }
  const diagnostic = failure instanceof ReaderDatabaseError && failure.kind !== "QUOTA_EXCEEDED"
    ? { ...storageFullError, message: "브라우저가 저장 요청을 처리하지 못했습니다." }
    : storageFullDiagnostic(requiredBytes, estimate);
  return {
    ...diagnostic,
    message: `EPUB ${recordLabel} 저장에 실패했습니다. ${diagnostic.message}`,
  };
}

function validBookId(bookId: string): boolean {
  return /^[a-f0-9]{64}$/i.test(bookId);
}

function archiveChunkId(bookId: string, index: number): string {
  return `${bookId}:${index}`;
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBytes(encodedBytes: string): Uint8Array {
  const binary = atob(encodedBytes);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function archiveChunks(bookId: string, archiveBytes: ArrayBuffer): LocalEpubArchiveChunkRecord[] {
  const bytes = new Uint8Array(archiveBytes);
  const chunks: LocalEpubArchiveChunkRecord[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += ARCHIVE_CHUNK_BYTES) {
    const index = chunks.length;
    chunks.push(LocalEpubArchiveChunkRecordSchema.parse({
      id: archiveChunkId(bookId, index),
      bookId,
      index,
      encodedBytes: encodeBytes(bytes.subarray(offset, offset + ARCHIVE_CHUNK_BYTES)),
    }));
  }
  return chunks;
}

function validateImport(input: LocalEpubImport): { book: LocalEpubBook; catalog: CatalogSource; chapterPaths: string[] } {
  if (typeof Blob === "undefined" || !(input.archive instanceof Blob)) throw new TypeError("Invalid EPUB archive");
  const book = LocalEpubBookSchema.parse(input.book);
  if (book.sourceByteSize !== input.archive.size) throw new TypeError("Archive size does not match metadata");
  if (book.chapters.some((chapter, index) => chapter.index !== index || chapter.canonicalUrl !== createLocalEpubLocator(book.id, index))) {
    throw new TypeError("EPUB chapter metadata must be ordered locators");
  }
  if (
    input.chapterPaths.length !== book.chapters.length
    || input.chapterPaths.some((path) => typeof path !== "string" || path.length === 0)
    || new Set(input.chapterPaths).size !== input.chapterPaths.length
  ) throw new TypeError("EPUB chapter paths must match content");
  const catalog = LocalEpubCatalogSchema.parse(input.catalog);
  if (catalog.bookId !== book.id) throw new TypeError("EPUB catalog does not match metadata");
  if (
    catalog.chapters.length !== book.chapters.length
    || catalog.chapters.some((chapter, index) => {
      const metadata = book.chapters[index];
      return chapter.url !== metadata.canonicalUrl || chapter.title !== metadata.title || chapter.sourceIndex !== index;
    })
  ) throw new TypeError("EPUB catalog does not match metadata");
  return { book, catalog, chapterPaths: input.chapterPaths };
}

export function createLocalEpubLibrary({
  database,
  catalogCache,
  storage = globalThis.navigator?.storage,
}: LocalEpubLibraryOptions): LocalEpubLibrary {
  const bookStore = READER_DB_SCHEMA.stores.epubBooks.name;
  const archiveStore = READER_DB_SCHEMA.stores.epubArchives.name;
  const archiveChunkStore = READER_DB_SCHEMA.stores.epubArchiveChunks.name;

  async function loadArchiveBytes(bookId: string, archive: LocalEpubArchiveRecord): Promise<ArrayBuffer | undefined> {
    const values = await database.run(archiveChunkStore, "readonly", (store) =>
      store.iterateIndex<unknown>(READER_DB_SCHEMA.stores.epubArchiveChunks.indexes.bookId));
    const chunks: LocalEpubArchiveChunkRecord[] = [];
    for (const value of values) {
      const parsed = LocalEpubArchiveChunkRecordSchema.safeParse(value);
      if (parsed.success && parsed.data.bookId === bookId) chunks.push(parsed.data);
    }
    chunks.sort((left, right) => left.index - right.index);
    if (
      chunks.length !== archive.chunkCount
      || chunks.some((chunk, index) => chunk.index !== index || chunk.id !== archiveChunkId(bookId, index))
    ) return undefined;

    const bytes = new Uint8Array(archive.byteSize);
    let offset = 0;
    for (const chunk of chunks) {
      const decoded = decodeBytes(chunk.encodedBytes);
      if (offset + decoded.byteLength > bytes.byteLength) return undefined;
      bytes.set(decoded, offset);
      offset += decoded.byteLength;
    }
    return offset === bytes.byteLength ? bytes.buffer : undefined;
  }

  return {
    async import(input) {
      let parsed: ReturnType<typeof validateImport>;
      try {
        parsed = validateImport(input);
      } catch {
        return { ok: false, error: storageFullError };
      }

      const metadataBytes = new TextEncoder().encode(JSON.stringify({
        book: parsed.book,
        catalog: parsed.catalog,
        chapterPaths: parsed.chapterPaths,
      })).byteLength;
      const requiredBytes = input.archive.size + metadataBytes;
      try {
        const estimate = await storage?.estimate?.();
        if (
          typeof estimate?.usage === "number"
          && typeof estimate.quota === "number"
          && estimate.usage + requiredBytes > estimate.quota
        ) return { ok: false, error: storageFullDiagnostic(requiredBytes, estimate) };
      } catch {
        // Some browsers expose StorageManager but reject quota estimation.
      }
      try {
        await storage?.persist?.();
      } catch {
        // Persistent storage is an optimization; IndexedDB remains usable without it.
      }

      try {
        const archiveBytes = await input.archive.arrayBuffer();
        const chunks = archiveChunks(parsed.book.id, archiveBytes);
        const archive: LocalEpubArchiveRecord = LocalEpubArchiveRecordSchema.parse({
          bookId: parsed.book.id,
          byteSize: archiveBytes.byteLength,
          chunkCount: chunks.length,
          chapterPaths: parsed.chapterPaths,
        });
        for (const chunk of chunks) {
          await database.run(archiveChunkStore, "readwrite", (store) => store.put(chunk));
        }
        await database.run(archiveStore, "readwrite", (store) => store.put(archive));
      } catch (error) {
        return { ok: false, error: await storageWriteDiagnostic(storage, requiredBytes, "archive", error) };
      }
      try {
        await catalogCache.put(parsed.catalog);
      } catch (error) {
        return { ok: false, error: await storageWriteDiagnostic(storage, requiredBytes, "목차", error) };
      }
      try {
        await database.run(bookStore, "readwrite", (store) => store.put(parsed.book));
        return { ok: true, book: parsed.book };
      } catch (error) {
        return { ok: false, error: await storageWriteDiagnostic(storage, requiredBytes, "책 메타데이터", error) };
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
        if (!parsed.success || parsed.data.bookId !== bookId) return undefined;
        const archiveBytes = await loadArchiveBytes(bookId, parsed.data);
        return archiveBytes ? new Blob([archiveBytes], { type: "application/epub+zip" }) : undefined;
      } catch {
        return undefined;
      }
    },

    async openChapter(bookId, index) {
      if (!validBookId(bookId) || !Number.isSafeInteger(index) || index < 0) return { status: "miss" };
      try {
        const [bookValue, archiveValue] = await Promise.all([
          database.run(bookStore, "readonly", (store) => store.get<unknown>(bookId)),
          database.run(archiveStore, "readonly", (store) => store.get<unknown>(bookId)),
        ]);
        const book = LocalEpubBookSchema.safeParse(bookValue);
        const archive = LocalEpubArchiveRecordSchema.safeParse(archiveValue);
        if (!book.success || !archive.success || archive.data.bookId !== bookId) return { status: "miss" };
        const chapterPath = archive.data.chapterPaths[index];
        if (!chapterPath) return { status: "miss" };
        const archiveBytes = await loadArchiveBytes(bookId, archive.data);
        if (!archiveBytes) return { status: "miss" };
        const chapter = await parseStoredEpubChapter(
          new Blob([archiveBytes], { type: "application/epub+zip" }),
          book.data,
          index,
          chapterPath,
        );
        return { status: "hit", chapter };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
