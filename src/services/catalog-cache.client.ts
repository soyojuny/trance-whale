import "client-only";

import { CatalogSourceSchema, type CatalogSource } from "../types/source";
import {
  CatalogCacheRecordSchema,
  type CatalogCacheRecord,
} from "../types/storage";
import {
  READER_DB_SCHEMA,
  type ReaderDatabase,
} from "./reader-db.client";

export const CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const canonicalUrlSchema = CatalogCacheRecordSchema.shape.canonicalUrl;

export type CatalogCacheLookup =
  | { status: "miss" }
  | { status: "fresh"; record: CatalogCacheRecord }
  | { status: "stale"; record: CatalogCacheRecord };

export interface CatalogCache {
  get(canonicalUrl: string): Promise<CatalogCacheLookup>;
  put(catalog: CatalogSource): Promise<CatalogCacheRecord>;
  delete(canonicalUrl: string): Promise<void>;
  clear(): Promise<void>;
}

type CatalogCacheOptions = {
  database: ReaderDatabase;
  now?: () => string;
};

function createRecord(catalogInput: CatalogSource, timestamp: string): CatalogCacheRecord {
  const catalog = CatalogSourceSchema.parse(catalogInput);
  return CatalogCacheRecordSchema.parse({
    canonicalUrl: catalog.canonicalUrl,
    catalog,
    createdAt: timestamp,
    accessedAt: timestamp,
    expiresAt: new Date(Date.parse(timestamp) + CATALOG_CACHE_TTL_MS).toISOString(),
  });
}

export function createCatalogCache({
  database,
  now = () => new Date().toISOString(),
}: CatalogCacheOptions): CatalogCache {
  const storeName = READER_DB_SCHEMA.stores.catalogs.name;

  return {
    async get(canonicalUrl) {
      const key = canonicalUrlSchema.parse(canonicalUrl);
      return database.run(storeName, "readwrite", async (store) => {
        const value = await store.get<unknown>(key);
        if (typeof value === "undefined") return { status: "miss" };

        const parsed = CatalogCacheRecordSchema.safeParse(value);
        if (!parsed.success || parsed.data.canonicalUrl !== key) return { status: "miss" };

        const record = parsed.data;
        const timestamp = now();
        if (Date.parse(timestamp) >= Date.parse(record.expiresAt)) {
          return { status: "stale", record };
        }

        const refreshed = CatalogCacheRecordSchema.parse({ ...record, accessedAt: timestamp });
        await store.put(refreshed);
        return { status: "fresh", record: refreshed };
      });
    },

    async put(catalog) {
      const record = createRecord(catalog, now());
      await database.run(storeName, "readwrite", (store) => store.put(record));
      return record;
    },

    async delete(canonicalUrl) {
      const key = canonicalUrlSchema.parse(canonicalUrl);
      await database.run(storeName, "readwrite", (store) => store.delete(key));
    },

    async clear() {
      await database.run(storeName, "readwrite", (store) => store.clear());
    },
  };
}
