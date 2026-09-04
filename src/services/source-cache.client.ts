import "client-only";

import { ChapterSourceSchema, type ChapterSource } from "../types/source";
import {
  SourceCacheRecordSchema,
  type SourceCacheRecord,
} from "../types/storage";
import {
  READER_DB_SCHEMA,
  type ReaderDatabase,
} from "./reader-db.client";

const canonicalUrlSchema = ChapterSourceSchema.shape.canonicalUrl;

export type SourceCacheLookup =
  | { status: "hit"; chapter: ChapterSource }
  | { status: "miss" }
  | { status: "unavailable" };

export type SourceCachePutResult =
  | { status: "stored"; record: SourceCacheRecord }
  | { status: "unavailable" };

export interface SourceCache {
  get(canonicalUrl: string): Promise<SourceCacheLookup>;
  put(chapter: ChapterSource): Promise<SourceCachePutResult>;
}

type SourceCacheOptions = {
  database: ReaderDatabase;
  now?: () => string;
};

function createRecord(chapterInput: ChapterSource, createdAt: string): SourceCacheRecord {
  const chapter = ChapterSourceSchema.parse(chapterInput);
  return SourceCacheRecordSchema.parse({
    canonicalUrl: chapter.canonicalUrl,
    createdAt,
    chapter,
  });
}

export function createSourceCache({
  database,
  now = () => new Date().toISOString(),
}: SourceCacheOptions): SourceCache {
  const storeName = READER_DB_SCHEMA.stores.sources.name;

  return {
    async get(canonicalUrl) {
      try {
        const key = canonicalUrlSchema.parse(canonicalUrl);
        const value = await database.run(storeName, "readonly", (store) => store.get<unknown>(key));
        if (typeof value === "undefined") return { status: "miss" };

        const parsed = SourceCacheRecordSchema.safeParse(value);
        if (!parsed.success || parsed.data.canonicalUrl !== key) return { status: "miss" };

        return { status: "hit", chapter: parsed.data.chapter };
      } catch {
        return { status: "unavailable" };
      }
    },

    async put(chapter) {
      try {
        const record = createRecord(chapter, now());
        await database.run(storeName, "readwrite", (store) => store.put(record));
        return { status: "stored", record };
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}
