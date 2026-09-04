import { describe, expect, expectTypeOf, it } from "vitest";

import { DEFAULT_TRANSLATION_MODE } from "../../src/lib/translation/models";
import type { CatalogSource } from "../../src/types/source";
import {
  CatalogCacheRecordSchema,
  DEFAULT_READER_SETTINGS,
  DEFAULT_TRANSLATION_SETTINGS,
  LastReadingPositionSchema,
  ReaderSettingsSchema,
  TranslationCacheRecordSchema,
  TranslationSettingsSchema,
  type CatalogCacheRecord,
  type LastReadingPosition,
  type ReaderSettings,
  type TranslationCacheRecord,
  type TranslationSettings,
} from "../../src/types/storage";

const timestamp = "2026-09-04T01:00:00.000Z";

const catalog: CatalogSource = {
  kind: "catalog",
  sourceUrl: "https://www.69shuba.com/book/48273/",
  canonicalUrl: "https://www.69shuba.com/book/48273/",
  siteId: "69shuba",
  bookId: "48273",
  bookTitle: "示例作品",
  chapters: [
    {
      id: "32028706",
      url: "https://www.69shuba.com/txt/48273/32028706",
      title: "第四十二章",
      number: 42,
      sourceIndex: 0,
    },
  ],
  fetchedAt: timestamp,
};

const translationCacheRecord = {
  cacheKey: "a".repeat(64),
  canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
  contentHash: "b".repeat(64),
  modelId: "central-catalog-model",
  targetLanguage: "ko",
  basePromptVersion: "v1",
  userPromptHash: "c".repeat(64),
  translatedParagraphs: [
    { id: "paragraph-1", text: "첫 문단." },
    { id: "paragraph-2", text: "둘째 문단." },
  ],
  createdAt: timestamp,
  accessedAt: timestamp,
  byteSize: 128,
};

const catalogCacheRecord = {
  canonicalUrl: catalog.canonicalUrl,
  catalog,
  createdAt: timestamp,
  accessedAt: timestamp,
  expiresAt: "2026-09-05T01:00:00.000Z",
};

describe("storage runtime contracts", () => {
  it("parses valid settings, position, and cache records", () => {
    const translationSettings = {
      apiKey: "browser-only-key",
      userPrompt: "이름을 음역해 주세요.",
      translationMode: "quality" as const,
    };
    const readerSettings = { viewMode: "both" as const, fontSize: 20, lineHeight: 2 };
    const lastReadingPosition = {
      canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
      scrollPosition: 320,
      updatedAt: timestamp,
    };

    expect(TranslationSettingsSchema.parse(translationSettings)).toEqual(translationSettings);
    expect(ReaderSettingsSchema.parse(readerSettings)).toEqual(readerSettings);
    expect(LastReadingPositionSchema.parse(lastReadingPosition)).toEqual(lastReadingPosition);
    expect(TranslationCacheRecordSchema.parse(translationCacheRecord)).toEqual(
      translationCacheRecord,
    );
    expect(CatalogCacheRecordSchema.parse(catalogCacheRecord)).toEqual(catalogCacheRecord);

    expectTypeOf(TranslationSettingsSchema.parse(translationSettings)).toEqualTypeOf<TranslationSettings>();
    expectTypeOf(ReaderSettingsSchema.parse(readerSettings)).toEqualTypeOf<ReaderSettings>();
    expectTypeOf(LastReadingPositionSchema.parse(lastReadingPosition)).toEqualTypeOf<LastReadingPosition>();
    expectTypeOf(TranslationCacheRecordSchema.parse(translationCacheRecord)).toEqualTypeOf<TranslationCacheRecord>();
    expectTypeOf(CatalogCacheRecordSchema.parse(catalogCacheRecord)).toEqualTypeOf<CatalogCacheRecord>();
  });

  it.each([
    ["unsupported view mode", ReaderSettingsSchema, { viewMode: "summary", fontSize: 19, lineHeight: 2 }],
    ["font size below range", ReaderSettingsSchema, { viewMode: "translation", fontSize: 15, lineHeight: 2 }],
    ["font size above range", ReaderSettingsSchema, { viewMode: "translation", fontSize: 25, lineHeight: 2 }],
    ["negative scroll position", LastReadingPositionSchema, { canonicalUrl: "https://www.69shuba.com/book/1/", scrollPosition: -1, updatedAt: timestamp }],
    ["invalid timestamp", LastReadingPositionSchema, { canonicalUrl: "https://www.69shuba.com/book/1/", scrollPosition: 0, updatedAt: "yesterday" }],
    ["duplicate translated IDs", TranslationCacheRecordSchema, { ...translationCacheRecord, translatedParagraphs: [{ id: "p-1", text: "하나" }, { id: "p-1", text: "둘" }] }],
  ])("rejects %s", (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("rejects secret and raw prompt fields in IndexedDB records", () => {
    expect(
      TranslationCacheRecordSchema.safeParse({ ...translationCacheRecord, apiKey: "secret" }).success,
    ).toBe(false);
    expect(
      TranslationCacheRecordSchema.safeParse({ ...translationCacheRecord, userPrompt: "raw" }).success,
    ).toBe(false);
    expect(CatalogCacheRecordSchema.safeParse({ ...catalogCacheRecord, apiKey: "secret" }).success).toBe(
      false,
    );
    expect(
      CatalogCacheRecordSchema.safeParse({ ...catalogCacheRecord, userPrompt: "raw" }).success,
    ).toBe(false);
  });

  it("exports valid defaults using the central translation default", () => {
    expect(TranslationSettingsSchema.parse(DEFAULT_TRANSLATION_SETTINGS)).toEqual(
      DEFAULT_TRANSLATION_SETTINGS,
    );
    expect(ReaderSettingsSchema.parse(DEFAULT_READER_SETTINGS)).toEqual(DEFAULT_READER_SETTINGS);
    expect(DEFAULT_TRANSLATION_SETTINGS.translationMode).toBe(DEFAULT_TRANSLATION_MODE);
    expect(DEFAULT_READER_SETTINGS.fontSize).toBeGreaterThanOrEqual(16);
    expect(DEFAULT_READER_SETTINGS.fontSize).toBeLessThanOrEqual(24);
  });
});
