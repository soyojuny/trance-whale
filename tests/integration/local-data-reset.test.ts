import { describe, expect, it, vi } from "vitest";

import {
  APP_CACHE_STORAGE_PREFIX,
  createLocalDataService,
} from "../../src/services/local-data.client";
import { PREFERENCE_STORAGE_KEYS, createPreferencesService } from "../../src/services/preferences.client";
import { READER_DB_SCHEMA } from "../../src/services/reader-db.client";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

type RequestHandler = ((event: Event) => void) | null;

function createIndexedDbFactory(failure?: "error" | "blocked") {
  const deleteDatabase = vi.fn((name: string) => {
    void name;
    const request = {
      error: null,
      onsuccess: null as RequestHandler,
      onerror: null as RequestHandler,
      onblocked: null as RequestHandler,
    };
    queueMicrotask(() => {
      if (failure === "error") request.onerror?.(new Event("error"));
      else if (failure === "blocked") request.onblocked?.(new Event("blocked"));
      else request.onsuccess?.(new Event("success"));
    });
    return request as IDBOpenDBRequest;
  });
  return { deleteDatabase };
}

class MemoryCacheStorage {
  readonly names = new Set<string>();
  readonly deleted: string[] = [];
  failure: Error | null = null;

  async keys() { return [...this.names]; }
  async delete(name: string) {
    if (this.failure) throw this.failure;
    this.deleted.push(name);
    this.names.delete(name);
    return true;
  }
}

describe("local data reset", () => {
  it("removes all Trance Whale browser data while preserving unrelated origin data", async () => {
    const storage = new MemoryStorage();
    for (const key of Object.values(PREFERENCE_STORAGE_KEYS)) storage.setItem(key, "private stored value");
    storage.setItem("another-app:key", "keep");
    const indexedDb = createIndexedDbFactory();
    const cacheStorage = new MemoryCacheStorage();
    cacheStorage.names.add(`${APP_CACHE_STORAGE_PREFIX}build-123`);
    cacheStorage.names.add("another-app-cache");

    const result = await createLocalDataService({
      preferences: createPreferencesService(storage),
      indexedDb,
      cacheStorage,
    }).clearAll();

    expect(result).toEqual({
      preferences: { ok: true },
      readerDatabase: { ok: true },
      cacheStorage: { ok: true },
    });
    for (const key of Object.values(PREFERENCE_STORAGE_KEYS)) expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem("another-app:key")).toBe("keep");
    expect(indexedDb.deleteDatabase).toHaveBeenCalledWith(READER_DB_SCHEMA.name);
    expect(cacheStorage.deleted).toEqual([`${APP_CACHE_STORAGE_PREFIX}build-123`]);
    expect(cacheStorage.names).toEqual(new Set(["another-app-cache"]));
  });

  it("continues deleting other areas and returns safe per-area failures", async () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFERENCE_STORAGE_KEYS.translation, "secret-api-key");
    storage.removeItem = () => { throw new Error("secret-api-key browser detail"); };
    const indexedDb = createIndexedDbFactory("blocked");
    const cacheStorage = new MemoryCacheStorage();
    cacheStorage.names.add(`${APP_CACHE_STORAGE_PREFIX}private-book-url`);

    const result = await createLocalDataService({
      preferences: createPreferencesService(storage),
      indexedDb,
      cacheStorage,
    }).clearAll();

    expect(result).toEqual({
      preferences: {
        ok: false,
        error: { code: "STORAGE_FULL", message: "저장된 설정을 삭제할 수 없습니다.", retryable: true },
      },
      readerDatabase: {
        ok: false,
        error: { code: "STORAGE_FULL", message: "저장된 읽기 데이터를 삭제할 수 없습니다.", retryable: true },
      },
      cacheStorage: { ok: true },
    });
    expect(cacheStorage.deleted).toHaveLength(1);
    expect(JSON.stringify(result)).not.toMatch(/secret-api-key|private-book-url|browser detail/);
  });

  it("is idempotent when every owned storage area is already empty", async () => {
    const storage = new MemoryStorage();
    const indexedDb = createIndexedDbFactory();
    const cacheStorage = new MemoryCacheStorage();
    const service = createLocalDataService({
      preferences: createPreferencesService(storage),
      indexedDb,
      cacheStorage,
    });

    await expect(service.clearAll()).resolves.toEqual({
      preferences: { ok: true },
      readerDatabase: { ok: true },
      cacheStorage: { ok: true },
    });
    await expect(service.clearAll()).resolves.toEqual({
      preferences: { ok: true },
      readerDatabase: { ok: true },
      cacheStorage: { ok: true },
    });
  });

  it("isolates Cache Storage failures without exposing the original exception", async () => {
    const cacheStorage = new MemoryCacheStorage();
    cacheStorage.failure = new Error("translated paragraph and private URL");
    cacheStorage.names.add(`${APP_CACHE_STORAGE_PREFIX}build-123`);

    const result = await createLocalDataService({
      preferences: createPreferencesService(new MemoryStorage()),
      indexedDb: createIndexedDbFactory(),
      cacheStorage,
    }).clearAll();

    expect(result.cacheStorage).toEqual({
      ok: false,
      error: { code: "STORAGE_FULL", message: "저장된 앱 캐시를 삭제할 수 없습니다.", retryable: true },
    });
    expect(result.preferences).toEqual({ ok: true });
    expect(result.readerDatabase).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toMatch(/translated paragraph|private URL/);
  });
});
