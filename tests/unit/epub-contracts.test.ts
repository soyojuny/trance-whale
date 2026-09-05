import { describe, expect, it } from "vitest";

import {
  LocalEpubBookSchema,
  LocalEpubCatalogSchema,
  LocalEpubChapterSchema,
  LocalEpubLocatorSchema,
} from "../../src/types/epub";
import { ChapterSourceSchema, SourceRequestSchema } from "../../src/types/source";

const bookId = "a".repeat(64);
const locator = `local-epub://book/${bookId}/chapter/0`;
const fetchedAt = "2026-09-05T00:00:00.000Z";

const chapter = {
  kind: "chapter",
  sourceUrl: locator,
  canonicalUrl: locator,
  siteId: "local-epub",
  bookId,
  bookTitle: "합성 책",
  chapterTitle: "첫 장",
  paragraphs: [{ id: "paragraph-1", text: "안전한 문단" }],
  navigation: {},
  contentHash: "a".repeat(64),
  fetchedAt,
};

describe("local EPUB contracts", () => {
  it("accepts local locators in local sources while keeping API requests HTTP-only", () => {
    expect(LocalEpubLocatorSchema.parse(locator)).toBe(locator);
    expect(ChapterSourceSchema.parse(chapter)).toEqual(chapter);
    expect(LocalEpubChapterSchema.parse(chapter)).toEqual(chapter);
    expect(SourceRequestSchema.safeParse({ url: locator }).success).toBe(false);
  });

  it("validates only local chapter and catalog metadata", () => {
    const book = {
      id: bookId, title: "합성 책", sourceByteSize: 1024, importedAt: fetchedAt,
      chapters: [{ index: 0, canonicalUrl: locator, title: "첫 장" }],
    };
    const catalog = {
      kind: "catalog", sourceUrl: locator, canonicalUrl: locator, siteId: "local-epub",
      bookId: "a".repeat(64), bookTitle: "합성 책",
      chapters: [{ id: "chapter-0", url: locator, title: "첫 장", sourceIndex: 0 }], fetchedAt,
    };

    expect(LocalEpubBookSchema.parse(book)).toEqual(book);
    expect(LocalEpubCatalogSchema.parse(catalog)).toEqual(catalog);
    expect(LocalEpubLocatorSchema.safeParse("local-epub://book/a/chapter/-1").success).toBe(false);
    expect(LocalEpubChapterSchema.safeParse({ ...chapter, siteId: "69shuba" }).success).toBe(false);
    expect(LocalEpubCatalogSchema.safeParse({ ...catalog, chapters: [{ ...catalog.chapters[0], url: "https://example.com/chapter" }] }).success).toBe(false);
  });
});
