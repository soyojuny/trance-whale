import { describe, expect, it } from "vitest";

import { EPUB_LIMITS, EpubParserError, parseEpub, parseStoredEpubChapter } from "../../src/lib/epub/parse-epub.client";
import { syntheticEpubFixture } from "../fixtures/epub/synthetic-epub";
import { strToU8 } from "fflate";

const importedAt = "2026-09-05T00:00:00.000Z";

async function expectEpubFailure(
  file: Blob,
  reason: EpubParserError["reason"],
  options: Parameters<typeof parseEpub>[1] = {},
) {
  await expect(parseEpub(file, { importedAt, ...options })).rejects.toMatchObject({ reason });
}

describe("browser EPUB parser", () => {
  it("extracts deterministic local chapter and catalog data without raw XHTML", async () => {
    const parsed = await parseEpub(syntheticEpubFixture(), { importedAt });
    const again = await parseEpub(syntheticEpubFixture(), { importedAt });

    expect(parsed.book).toEqual(again.book);
    expect(parsed.book.chapters).toEqual([
      expect.objectContaining({ index: 0, title: "첫 항해" }),
      expect.objectContaining({ index: 1, title: "둘째 항해" }),
    ]);
    expect(parsed.chapters.map((chapter) => chapter.canonicalUrl)).toEqual([
      `local-epub://book/${parsed.book.id}/chapter/0`,
      `local-epub://book/${parsed.book.id}/chapter/1`,
    ]);
    expect(parsed.chapters[0].paragraphs).toEqual([
      { id: "paragraph-1", text: "고래는 바다를 보았다." },
      { id: "paragraph-2", text: "파도는 조용했다." },
    ]);
    expect(parsed.catalog.chapters.map(({ title, sourceIndex }) => ({ title, sourceIndex }))).toEqual([
      { title: "첫 항해", sourceIndex: 0 },
      { title: "둘째 항해", sourceIndex: 1 },
    ]);
    expect(parsed.chapterPaths).toEqual(["OPS/text/chapter-1.xhtml", "OPS/text/chapter-2.xhtml"]);
    expect(JSON.stringify(parsed)).not.toMatch(/<script|<style|<iframe|onclick=/i);
  });

  it("extracts one stored EPUB chapter without rebuilding the book", async () => {
    const file = syntheticEpubFixture();
    const parsed = await parseEpub(file, { importedAt });

    await expect(parseStoredEpubChapter(file, parsed.book, 1, parsed.chapterPaths[1], importedAt)).resolves.toMatchObject({
      chapterNumber: 2,
      chapterTitle: "둘째 항해",
      paragraphs: [{ id: "paragraph-1", text: "배는 항구를 떠났다." }],
    });
  });

  it("rejects a damaged container and central-directory limits before extraction", async () => {
    await expectEpubFailure(syntheticEpubFixture({ container: "not xml" }), "INVALID_CONTAINER");
    await expectEpubFailure(syntheticEpubFixture(), "ZIP_LIMIT", { limits: { maxEntries: 1 } });
  });

  it("accepts long serializations up to 2,000 chapters and rejects larger ones", async () => {
    const parsed = await parseEpub(syntheticEpubFixture({ chapterCount: 1_500 }), { importedAt });

    expect(parsed.chapters).toHaveLength(1_500);
    await expectEpubFailure(syntheticEpubFixture({ chapterCount: 2_001 }), "ZIP_LIMIT");
  }, 30_000);

  it("supports up to 300,000 paragraphs across a long EPUB", () => {
    expect(EPUB_LIMITS.maxTotalParagraphs).toBe(300_000);
  });

  it("skips cover, navigation, and volume documents in the EPUB spine", async () => {
    const parsed = await parseEpub(syntheticEpubFixture({ structuralSpineItems: true }), { importedAt });

    expect(parsed.chapters.map((chapter) => chapter.chapterTitle)).toEqual(["첫 항해", "둘째 항해"]);
    expect(parsed.catalog.chapters.map((chapter) => chapter.title)).toEqual(["첫 항해", "둘째 항해"]);
  });

  it("rejects malformed XHTML, empty chapters, and invalid navigation", async () => {
    await expectEpubFailure(syntheticEpubFixture({ chapterOne: "<html><body><p>broken</body>" }), "INVALID_XHTML");
    await expectEpubFailure(syntheticEpubFixture({ chapterOne: "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body/></html>" }), "EMPTY_CHAPTER");
    await expectEpubFailure(syntheticEpubFixture({ navigation: "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><nav><a href=\"missing.xhtml\">없는 장</a></nav></body></html>" }), "INVALID_TOC");
  });

  it("distinguishes protected and image-only EPUBs", async () => {
    await expectEpubFailure(
      syntheticEpubFixture({ extraEntries: { "META-INF/encryption.xml": strToU8("<encryption/>") } }),
      "DRM_PROTECTED",
    );
    await expectEpubFailure(
      syntheticEpubFixture({ chapterOne: "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><img src=\"page.jpg\"/></body></html>" }),
      "IMAGE_BASED",
    );
  });
});
