import { describe, expect, it } from "vitest";

import {
  CatalogSourceSchema,
  ChapterSourceSchema,
  SourceRequestSchema,
} from "../../src/types/source";
import {
  PUBLIC_ERROR_CODES,
  PublicErrorSchema,
  SourceContractError,
  toPublicError,
} from "../../src/lib/errors";

const chapter = {
  kind: "chapter",
  sourceUrl: "https://www.69shuba.com/txt/48273/32028706",
  canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
  siteId: "69shuba",
  bookId: "48273",
  bookTitle: "示例作品",
  chapterId: "32028706",
  chapterNumber: 42,
  chapterTitle: "第四十二章 鲸落",
  paragraphs: [
    { id: "paragraph-1", text: "第一段。" },
    { id: "paragraph-2", text: "第二段。" },
  ],
  navigation: {
    previous: {
      url: "https://www.69shuba.com/txt/48273/32028705",
      label: "上一章",
    },
    catalog: { url: "https://www.69shuba.com/book/48273/" },
    next: { url: "https://www.69shuba.com/txt/48273/32028707" },
  },
  contentHash: "a".repeat(64),
  fetchedAt: "2026-09-04T01:00:00.000Z",
};

const catalog = {
  kind: "catalog",
  sourceUrl: "https://www.69shuba.com/book/48273/",
  canonicalUrl: "https://www.69shuba.com/book/48273/",
  siteId: "69shuba",
  bookId: "48273",
  bookTitle: "示例作品",
  chapters: [
    {
      id: "32028705",
      url: "https://www.69shuba.com/txt/48273/32028705",
      title: "第四十一章",
      number: 41,
      sourceIndex: 0,
    },
    {
      id: "32028706",
      url: "https://www.69shuba.com/txt/48273/32028706",
      title: "第四十二章",
      number: 42,
      sourceIndex: 1,
    },
  ],
  fetchedAt: "2026-09-04T01:00:00.000Z",
};

describe("source API contracts", () => {
  it("accepts valid chapter, catalog, and URL request data", () => {
    expect(ChapterSourceSchema.parse(chapter)).toEqual(chapter);
    expect(CatalogSourceSchema.parse(catalog)).toEqual(catalog);
    expect(
      SourceRequestSchema.parse({
        url: "https://www.69shuba.com/txt/48273/32028706",
      }),
    ).toEqual({ url: "https://www.69shuba.com/txt/48273/32028706" });
  });

  it.each([
    ["empty paragraphs", { ...chapter, paragraphs: [] }],
    ["empty paragraph text", { ...chapter, paragraphs: [{ id: "p-1", text: "" }] }],
    [
      "duplicate paragraph IDs",
      {
        ...chapter,
        paragraphs: [
          { id: "p-1", text: "first" },
          { id: "p-1", text: "second" },
        ],
      },
    ],
    ["invalid paragraph ID", { ...chapter, paragraphs: [{ id: "bad id", text: "text" }] }],
    ["invalid source URL", { ...chapter, sourceUrl: "not-a-url" }],
  ])("rejects %s", (_name, value) => {
    expect(ChapterSourceSchema.safeParse(value).success).toBe(false);
  });

  it("rejects invalid catalog boundary data", () => {
    expect(CatalogSourceSchema.safeParse({ ...catalog, chapters: [] }).success).toBe(false);
    expect(
      CatalogSourceSchema.safeParse({
        ...catalog,
        chapters: [{ ...catalog.chapters[0], url: "javascript:alert(1)" }],
      }).success,
    ).toBe(false);
  });

  it.each(["", "not-a-url", "ftp://www.69shuba.com/book/48273/"])(
    "rejects an invalid request URL: %s",
    (url) => {
      expect(SourceRequestSchema.safeParse({ url }).success).toBe(false);
    },
  );
});

describe("public error contract", () => {
  it("contains every documented public error code", () => {
    expect(PUBLIC_ERROR_CODES).toEqual([
      "INVALID_URL",
      "UNSUPPORTED_SITE",
      "SOURCE_BLOCKED",
      "SOURCE_UNREACHABLE",
      "SOURCE_TOO_LARGE",
      "EXTRACTION_FAILED",
      "INVALID_EPUB",
      "EPUB_TOO_LARGE",
      "EPUB_UNSUPPORTED",
      "INVALID_API_KEY",
      "MODEL_UNAVAILABLE",
      "QUOTA_EXCEEDED",
      "TRANSLATION_BLOCKED",
      "TRANSLATION_FAILED",
      "STORAGE_FULL",
      "OFFLINE",
    ]);
  });

  it("maps a known internal error to a valid fixed public error", () => {
    const error = toPublicError(
      new SourceContractError("SOURCE_UNREACHABLE", "upstream response body: secret"),
    );

    expect(PublicErrorSchema.parse(error)).toEqual({
      code: "SOURCE_UNREACHABLE",
      message: "원본 사이트에 연결할 수 없습니다.",
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("does not expose unknown exception messages or upstream bodies", () => {
    const error = toPublicError(
      new Error("API_KEY=secret; upstream response body: private chapter"),
    );

    expect(error).toEqual({
      code: "EXTRACTION_FAILED",
      message: "본문 정보를 추출할 수 없습니다.",
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(JSON.stringify(error)).not.toContain("private chapter");
  });
});
