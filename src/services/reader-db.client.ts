import "client-only";

export const READER_DB_SCHEMA = {
  name: "trance-whale-reader",
  version: 6,
  stores: {
    translations: {
      name: "translation-cache",
      keyPath: "cacheKey",
      indexes: { accessedAt: "accessed-at" },
    },
    catalogs: {
      name: "catalog-cache",
      keyPath: "canonicalUrl",
    },
    sources: {
      name: "source-cache",
      keyPath: "canonicalUrl",
    },
    epubBooks: {
      name: "local-epub-books",
      keyPath: "id",
    },
    epubArchives: {
      name: "local-epub-archives",
      keyPath: "bookId",
    },
    epubArchiveChunks: {
      name: "local-epub-archive-chunks",
      keyPath: "id",
      indexes: { bookId: "book-id" },
    },
  },
} as const;

export type ReaderDbFailureKind =
  | "BLOCKED"
  | "ABORTED"
  | "QUOTA_EXCEEDED"
  | "REQUEST_FAILED"
  | "UNKNOWN";

export class ReaderDatabaseError extends Error {
  constructor(readonly kind: ReaderDbFailureKind) {
    super("IndexedDB operation failed");
    this.name = "ReaderDatabaseError";
  }
}

export interface ReaderDbFactory {
  open(name: string, version: number): IDBOpenDBRequest;
}

export type ReaderDbStoreName =
  (typeof READER_DB_SCHEMA.stores)[keyof typeof READER_DB_SCHEMA.stores]["name"];

export interface ReaderDbStore {
  get<T>(key: IDBValidKey): Promise<T | undefined>;
  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  delete(key: IDBValidKey): Promise<void>;
  clear(): Promise<void>;
  iterateIndex<T>(indexName: string, direction?: IDBCursorDirection): Promise<T[]>;
}

export interface ReaderDatabase {
  run<T>(
    storeName: ReaderDbStoreName,
    mode: IDBTransactionMode,
    operation: (store: ReaderDbStore) => T | Promise<T>,
  ): Promise<T>;
  close(): void;
}

function classifyFailure(error: unknown, fallback: ReaderDbFailureKind): ReaderDatabaseError {
  if (error instanceof ReaderDatabaseError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new ReaderDatabaseError("QUOTA_EXCEEDED");
  }
  return new ReaderDatabaseError(fallback);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(classifyFailure(request.error, "REQUEST_FAILED"));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(classifyFailure(transaction.error, "ABORTED"));
    transaction.onerror = () => reject(classifyFailure(transaction.error, "REQUEST_FAILED"));
  });
}

function createStore(store: IDBObjectStore): ReaderDbStore {
  return {
    get: <T>(key: IDBValidKey) => requestToPromise(store.get(key) as IDBRequest<T | undefined>),
    put: (value: unknown, key?: IDBValidKey) => requestToPromise(
      typeof key === "undefined" ? store.put(value) : store.put(value, key),
    ),
    delete: async (key: IDBValidKey) => {
      await requestToPromise(store.delete(key));
    },
    clear: async () => {
      await requestToPromise(store.clear());
    },
    iterateIndex: <T>(indexName: string, direction: IDBCursorDirection = "next") =>
      new Promise<T[]>((resolve, reject) => {
        const values: T[] = [];
        let request: IDBRequest<IDBCursorWithValue | null>;
        try {
          request = store.index(indexName).openCursor(null, direction);
        } catch (error) {
          reject(classifyFailure(error, "UNKNOWN"));
          return;
        }
        request.onerror = () => reject(classifyFailure(request.error, "REQUEST_FAILED"));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor === null) {
            resolve(values);
            return;
          }
          values.push(cursor.value as T);
          cursor.continue();
        };
      }),
  };
}

function upgradeDatabase(database: IDBDatabase): void {
  const translations = READER_DB_SCHEMA.stores.translations;
  if (!database.objectStoreNames.contains(translations.name)) {
    database
      .createObjectStore(translations.name, { keyPath: translations.keyPath })
      .createIndex(translations.indexes.accessedAt, "accessedAt", { unique: false });
  }

  const catalogs = READER_DB_SCHEMA.stores.catalogs;
  if (!database.objectStoreNames.contains(catalogs.name)) {
    database.createObjectStore(catalogs.name, { keyPath: catalogs.keyPath });
  }

  const sources = READER_DB_SCHEMA.stores.sources;
  if (!database.objectStoreNames.contains(sources.name)) {
    database.createObjectStore(sources.name, { keyPath: sources.keyPath });
  }

  const epubBooks = READER_DB_SCHEMA.stores.epubBooks;
  if (!database.objectStoreNames.contains(epubBooks.name)) {
    database.createObjectStore(epubBooks.name, { keyPath: epubBooks.keyPath });
  }

  const epubArchives = READER_DB_SCHEMA.stores.epubArchives;
  if (!database.objectStoreNames.contains(epubArchives.name)) {
    database.createObjectStore(epubArchives.name, { keyPath: epubArchives.keyPath });
  }

  const epubArchiveChunks = READER_DB_SCHEMA.stores.epubArchiveChunks;
  if (!database.objectStoreNames.contains(epubArchiveChunks.name)) {
    database
      .createObjectStore(epubArchiveChunks.name, { keyPath: epubArchiveChunks.keyPath })
      .createIndex(epubArchiveChunks.indexes.bookId, "bookId", { unique: false });
  }
}

export function openReaderDatabase(
  factory: ReaderDbFactory = globalThis.indexedDB,
): Promise<ReaderDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let settled = false;
    try {
      request = factory.open(READER_DB_SCHEMA.name, READER_DB_SCHEMA.version);
    } catch (error) {
      reject(classifyFailure(error, "UNKNOWN"));
      return;
    }

    request.onupgradeneeded = () => {
      try {
        upgradeDatabase(request.result);
      } catch (error) {
        settled = true;
        request.transaction?.abort();
        reject(classifyFailure(error, "UNKNOWN"));
      }
    };
    request.onblocked = () => {
      settled = true;
      reject(new ReaderDatabaseError("BLOCKED"));
    };
    request.onerror = () => {
      settled = true;
      reject(classifyFailure(request.error, "UNKNOWN"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      resolve({
        async run<T>(storeName: ReaderDbStoreName, mode: IDBTransactionMode, operation: (store: ReaderDbStore) => T | Promise<T>) {
          let transaction: IDBTransaction;
          try {
            transaction = database.transaction(storeName, mode);
          } catch (error) {
            throw classifyFailure(error, "UNKNOWN");
          }

          const completion = transactionCompletion(transaction);
          const completionFailure = completion.then(
            () => new Promise<never>(() => undefined),
            (error: unknown) => Promise.reject(error),
          );
          try {
            const result = await Promise.race([
              Promise.resolve(operation(createStore(transaction.objectStore(storeName)))),
              completionFailure,
            ]);
            await completion;
            return result;
          } catch (error) {
            void completion.catch(() => undefined);
            throw classifyFailure(error, "UNKNOWN");
          }
        },
        close: () => database.close(),
      });
    };
  });
}
