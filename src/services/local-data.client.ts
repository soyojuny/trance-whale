import "client-only";

import type { PublicError } from "../lib/errors";
import { createPreferencesService, type StorageResult } from "./preferences.client";
import { READER_DB_SCHEMA } from "./reader-db.client";

export const APP_CACHE_STORAGE_PREFIX = "trance-whale-app-shell:";

type PreferencesReset = {
  clearPreferences(): StorageResult;
};

type IndexedDbDeleteFactory = {
  deleteDatabase(name: string): IDBOpenDBRequest;
};

type CacheStorageCompatible = {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
};

type ResetAreaResult = { ok: true } | { ok: false; error: PublicError };

export type LocalDataResetResult = {
  preferences: ResetAreaResult;
  readerDatabase: ResetAreaResult;
  cacheStorage: ResetAreaResult;
};

type LocalDataServiceOptions = {
  preferences?: PreferencesReset;
  indexedDb?: IndexedDbDeleteFactory;
  cacheStorage?: CacheStorageCompatible;
};

const readerDatabaseFailure: PublicError = {
  code: "STORAGE_FULL",
  message: "저장된 읽기 데이터를 삭제할 수 없습니다.",
  retryable: true,
};

const cacheStorageFailure: PublicError = {
  code: "STORAGE_FULL",
  message: "저장된 앱 캐시를 삭제할 수 없습니다.",
  retryable: true,
};

function deleteReaderDatabase(factory: IndexedDbDeleteFactory): Promise<ResetAreaResult> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(READER_DB_SCHEMA.name);
    } catch {
      resolve({ ok: false, error: readerDatabaseFailure });
      return;
    }

    request.onsuccess = () => resolve({ ok: true });
    request.onerror = () => resolve({ ok: false, error: readerDatabaseFailure });
    request.onblocked = () => resolve({ ok: false, error: readerDatabaseFailure });
  });
}

async function deleteAppCaches(cacheStorage: CacheStorageCompatible): Promise<ResetAreaResult> {
  try {
    const names = await cacheStorage.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(APP_CACHE_STORAGE_PREFIX))
        .map((name) => cacheStorage.delete(name)),
    );
    return { ok: true };
  } catch {
    return { ok: false, error: cacheStorageFailure };
  }
}

export function createLocalDataService({
  preferences = createPreferencesService(globalThis.localStorage),
  indexedDb = globalThis.indexedDB,
  cacheStorage = globalThis.caches,
}: LocalDataServiceOptions = {}) {
  return {
    async clearAll(): Promise<LocalDataResetResult> {
      let preferencesResult: ResetAreaResult;
      try {
        preferencesResult = preferences.clearPreferences();
      } catch {
        preferencesResult = {
          ok: false,
          error: {
            code: "STORAGE_FULL",
            message: "저장된 설정을 삭제할 수 없습니다.",
            retryable: true,
          },
        };
      }

      const [readerDatabase, cacheStorageResult] = await Promise.all([
        deleteReaderDatabase(indexedDb),
        deleteAppCaches(cacheStorage),
      ]);

      return {
        preferences: preferencesResult,
        readerDatabase,
        cacheStorage: cacheStorageResult,
      };
    },
  };
}
