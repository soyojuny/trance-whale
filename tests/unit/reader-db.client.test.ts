import { describe, expect, it } from "vitest";

import {
  READER_DB_SCHEMA,
  ReaderDatabaseError,
  openReaderDatabase,
  type ReaderDbFactory,
} from "../../src/services/reader-db.client";

type Handler = ((event: Event) => void) | null;

class FakeRequest<T = unknown> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;

  succeed(value: T): void {
    this.result = value;
    queueMicrotask(() => this.onsuccess?.(new Event("success")));
  }

  fail(error: DOMException): void {
    this.error = error;
    queueMicrotask(() => this.onerror?.(new Event("error")));
  }
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  requestError: DOMException | null = null;
  abortOnUse = false;

  constructor(readonly values: Map<IDBValidKey, unknown>) {}

  objectStore() {
    const run = <T>(action: () => T) => {
      const request = new FakeRequest<T>();
      if (this.abortOnUse) {
        queueMicrotask(() => this.onabort?.(new Event("abort")));
      } else if (this.requestError) {
        request.fail(this.requestError);
      } else {
        request.succeed(action());
        queueMicrotask(() => queueMicrotask(() => this.oncomplete?.(new Event("complete"))));
      }
      return request as unknown as IDBRequest<T>;
    };

    return {
      get: (key: IDBValidKey) => run(() => this.values.get(key)),
      put: (value: unknown, key?: IDBValidKey) => run(() => {
        this.values.set(key ?? (value as { cacheKey: IDBValidKey }).cacheKey, value);
        return key ?? (value as { cacheKey: IDBValidKey }).cacheKey;
      }),
      delete: (key: IDBValidKey) => run(() => { this.values.delete(key); }),
      index: () => ({ openCursor: () => run(() => null) }),
    } as unknown as IDBObjectStore;
  }
}

class FakeDatabase {
  version = 0;
  readonly stores = new Map<string, { keyPath: string; indexes: string[] }>();
  readonly valuesByStore = new Map<string, Map<IDBValidKey, unknown>>();
  lastTransaction: FakeTransaction | null = null;
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  } as DOMStringList;

  createObjectStore(name: string, options: IDBObjectStoreParameters) {
    const store = { keyPath: String(options.keyPath), indexes: [] as string[] };
    this.stores.set(name, store);
    return {
      createIndex: (indexName: string) => { store.indexes.push(indexName); },
    } as unknown as IDBObjectStore;
  }

  valuesFor(storeName: string): Map<IDBValidKey, unknown> {
    const values = this.valuesByStore.get(storeName) ?? new Map<IDBValidKey, unknown>();
    this.valuesByStore.set(storeName, values);
    return values;
  }

  transaction(storeName: string) {
    this.lastTransaction = new FakeTransaction(this.valuesFor(storeName));
    return this.lastTransaction as unknown as IDBTransaction;
  }

  close() {}
}

class FakeFactory implements ReaderDbFactory {
  readonly database = new FakeDatabase();
  blocked = false;
  openError: DOMException | null = null;
  upgrades = 0;

  open(_name: string, version: number): IDBOpenDBRequest {
    const request = new FakeRequest<IDBDatabase>() as FakeRequest<IDBDatabase> & {
      onblocked: Handler;
      onupgradeneeded: Handler;
      transaction: IDBTransaction | null;
    };
    request.onblocked = null;
    request.onupgradeneeded = null;
    request.transaction = null;

    queueMicrotask(() => {
      if (this.blocked) return request.onblocked?.(new Event("blocked"));
      if (this.openError) return request.fail(this.openError);
      const oldVersion = this.database.version;
      if (oldVersion < version) {
        this.upgrades += 1;
        this.database.version = version;
        const event = new Event("upgradeneeded") as IDBVersionChangeEvent;
        Object.defineProperties(event, {
          oldVersion: { value: oldVersion },
          newVersion: { value: version },
        });
        request.result = this.database as unknown as IDBDatabase;
        request.onupgradeneeded?.(event);
      }
      request.succeed(this.database as unknown as IDBDatabase);
    });
    return request as unknown as IDBOpenDBRequest;
  }
}

describe("reader database adapter", () => {
  it("creates each store and the translation LRU index exactly once", async () => {
    const factory = new FakeFactory();

    const first = await openReaderDatabase(factory);
    first.close();
    const second = await openReaderDatabase(factory);

    expect(factory.upgrades).toBe(1);
    expect([...factory.database.stores.entries()]).toEqual([
      [READER_DB_SCHEMA.stores.translations.name, {
        keyPath: "cacheKey",
        indexes: [READER_DB_SCHEMA.stores.translations.indexes.accessedAt],
      }],
      [READER_DB_SCHEMA.stores.catalogs.name, { keyPath: "canonicalUrl", indexes: [] }],
      [READER_DB_SCHEMA.stores.sources.name, { keyPath: "canonicalUrl", indexes: [] }],
      [READER_DB_SCHEMA.stores.epubBooks.name, { keyPath: "id", indexes: [] }],
      [READER_DB_SCHEMA.stores.epubArchives.name, { keyPath: "bookId", indexes: [] }],
      [READER_DB_SCHEMA.stores.epubArchiveChunks.name, {
        keyPath: "id",
        indexes: [READER_DB_SCHEMA.stores.epubArchiveChunks.indexes.bookId],
      }],
    ]);
    second.close();
  });

  it("upgrades the prior database without losing translation, catalog, or source records", async () => {
    const factory = new FakeFactory();
    const translation = { cacheKey: "translation-key", accessedAt: "2026-09-04T01:00:00.000Z" };
    const catalog = { canonicalUrl: "https://www.69shuba.com/book/48273/", createdAt: "2026-09-04T01:00:00.000Z" };
    const source = { canonicalUrl: "https://www.69shuba.com/txt/48273/1", createdAt: "2026-09-04T01:00:00.000Z" };

    factory.database.version = 2;
    factory.database.stores.set(READER_DB_SCHEMA.stores.translations.name, {
      keyPath: "cacheKey",
      indexes: [READER_DB_SCHEMA.stores.translations.indexes.accessedAt],
    });
    factory.database.stores.set(READER_DB_SCHEMA.stores.catalogs.name, {
      keyPath: "canonicalUrl",
      indexes: [],
    });
    factory.database.stores.set(READER_DB_SCHEMA.stores.sources.name, {
      keyPath: "canonicalUrl",
      indexes: [],
    });
    factory.database.valuesFor(READER_DB_SCHEMA.stores.translations.name)
      .set(translation.cacheKey, translation);
    factory.database.valuesFor(READER_DB_SCHEMA.stores.catalogs.name)
      .set(catalog.canonicalUrl, catalog);
    factory.database.valuesFor(READER_DB_SCHEMA.stores.sources.name)
      .set(source.canonicalUrl, source);

    const database = await openReaderDatabase(factory);

    await expect(database.run(
      READER_DB_SCHEMA.stores.translations.name,
      "readonly",
      (store) => store.get(translation.cacheKey),
    )).resolves.toEqual(translation);
    await expect(database.run(
      READER_DB_SCHEMA.stores.catalogs.name,
      "readonly",
      (store) => store.get(catalog.canonicalUrl),
    )).resolves.toEqual(catalog);
    await expect(database.run(
      READER_DB_SCHEMA.stores.sources.name,
      "readonly",
      (store) => store.get(source.canonicalUrl),
    )).resolves.toEqual(source);
    expect(factory.database.stores.get(READER_DB_SCHEMA.stores.epubBooks.name)).toEqual({
      keyPath: "id",
      indexes: [],
    });
    expect(factory.database.stores.get(READER_DB_SCHEMA.stores.epubArchives.name)).toEqual({
      keyPath: "bookId",
      indexes: [],
    });
    expect(factory.database.stores.get(READER_DB_SCHEMA.stores.epubArchiveChunks.name)).toEqual({
      keyPath: "id",
      indexes: [READER_DB_SCHEMA.stores.epubArchiveChunks.indexes.bookId],
    });
  });

  it("repairs version 4 databases that were created before the archive chunk store", async () => {
    const factory = new FakeFactory();
    factory.database.version = 4;
    factory.database.stores.set(READER_DB_SCHEMA.stores.translations.name, {
      keyPath: "cacheKey",
      indexes: [READER_DB_SCHEMA.stores.translations.indexes.accessedAt],
    });
    factory.database.stores.set(READER_DB_SCHEMA.stores.catalogs.name, {
      keyPath: "canonicalUrl",
      indexes: [],
    });
    factory.database.stores.set(READER_DB_SCHEMA.stores.sources.name, {
      keyPath: "canonicalUrl",
      indexes: [],
    });
    factory.database.stores.set(READER_DB_SCHEMA.stores.epubBooks.name, {
      keyPath: "id",
      indexes: [],
    });
    factory.database.stores.set(READER_DB_SCHEMA.stores.epubArchives.name, {
      keyPath: "bookId",
      indexes: [],
    });

    await openReaderDatabase(factory);

    expect(factory.upgrades).toBe(1);
    expect(factory.database.stores.get(READER_DB_SCHEMA.stores.epubArchiveChunks.name)).toEqual({
      keyPath: "id",
      indexes: [READER_DB_SCHEMA.stores.epubArchiveChunks.indexes.bookId],
    });
  });

  it("upgrades version 5 without rewriting legacy complete translation records", async () => {
    const factory = new FakeFactory();
    const legacy = { cacheKey: "legacy-translation", translatedParagraphs: [{ id: "p-1", text: "완료" }] };
    factory.database.version = 5;
    factory.database.stores.set(READER_DB_SCHEMA.stores.translations.name, {
      keyPath: "cacheKey",
      indexes: [READER_DB_SCHEMA.stores.translations.indexes.accessedAt],
    });
    factory.database.valuesFor(READER_DB_SCHEMA.stores.translations.name).set(legacy.cacheKey, legacy);

    const database = await openReaderDatabase(factory);

    expect(READER_DB_SCHEMA.version).toBe(6);
    expect(factory.upgrades).toBe(1);
    await expect(database.run(
      READER_DB_SCHEMA.stores.translations.name,
      "readonly",
      (store) => store.get(legacy.cacheKey),
    )).resolves.toEqual(legacy);
  });

  it("resolves readonly and readwrite work only after transaction completion", async () => {
    const factory = new FakeFactory();
    const database = await openReaderDatabase(factory);
    const record = { cacheKey: "cache-key", accessedAt: "2026-09-04T01:00:00.000Z" };

    await database.run(READER_DB_SCHEMA.stores.translations.name, "readwrite", (store) => store.put(record));
    const read = await database.run(READER_DB_SCHEMA.stores.translations.name, "readonly", (store) => store.get("cache-key"));
    await database.run(READER_DB_SCHEMA.stores.translations.name, "readwrite", (store) => store.delete("cache-key"));

    expect(read).toEqual(record);
  });

  it("classifies request, abort, quota, blocked, and unknown failures without leaking exception text", async () => {
    const factory = new FakeFactory();
    const database = await openReaderDatabase(factory);

    factory.database.transaction = function transaction(storeName: string) {
      this.lastTransaction = new FakeTransaction(this.valuesFor(storeName));
      this.lastTransaction.requestError = new DOMException("private record", "DataError");
      return this.lastTransaction as unknown as IDBTransaction;
    };
    await expect(database.run(READER_DB_SCHEMA.stores.translations.name, "readonly", (store) => store.get("key")))
      .rejects.toMatchObject({ kind: "REQUEST_FAILED", message: "IndexedDB operation failed" });

    factory.database.transaction = function transaction(storeName: string) {
      this.lastTransaction = new FakeTransaction(this.valuesFor(storeName));
      this.lastTransaction.abortOnUse = true;
      return this.lastTransaction as unknown as IDBTransaction;
    };
    await expect(database.run(READER_DB_SCHEMA.stores.translations.name, "readonly", (store) => store.get("key")))
      .rejects.toMatchObject({ kind: "ABORTED" });

    const quotaFactory = new FakeFactory();
    quotaFactory.openError = new DOMException("private quota detail", "QuotaExceededError");
    await expect(openReaderDatabase(quotaFactory)).rejects.toMatchObject({ kind: "QUOTA_EXCEEDED" });

    const blockedFactory = new FakeFactory();
    blockedFactory.blocked = true;
    await expect(openReaderDatabase(blockedFactory)).rejects.toMatchObject({ kind: "BLOCKED" });

    const unknownFactory = { open: () => { throw new Error("private browser detail"); } };
    const unknown = await openReaderDatabase(unknownFactory).catch((error: unknown) => error);
    expect(unknown).toBeInstanceOf(ReaderDatabaseError);
    expect(unknown).toMatchObject({ kind: "UNKNOWN", message: "IndexedDB operation failed" });
    expect(JSON.stringify(unknown)).not.toContain("private");
  });

  it("provides index cursor iteration through the injected test double", async () => {
    const factory = new FakeFactory();
    const database = await openReaderDatabase(factory);

    const values = await database.run(READER_DB_SCHEMA.stores.translations.name, "readonly", (store) =>
      store.iterateIndex(READER_DB_SCHEMA.stores.translations.indexes.accessedAt));

    expect(values).toEqual([]);
  });
});
