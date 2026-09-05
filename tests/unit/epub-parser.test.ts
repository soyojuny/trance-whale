import { describe, expect, it } from "vitest";

import { EpubParserError, parseEpub } from "../../src/lib/epub/parse-epub.client";
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
    expect(JSON.stringify(parsed)).not.toMatch(/<script|<style|<iframe|onclick=/i);
  });

  it("rejects a damaged container and central-directory limits before extraction", async () => {
    await expectEpubFailure(syntheticEpubFixture({ container: "not xml" }), "INVALID_CONTAINER");
    await expectEpubFailure(syntheticEpubFixture(), "ZIP_LIMIT", { limits: { maxEntries: 1 } });
  });

  it("rejects malformed XHTML, empty chapters, and invalid navigation", async () => {
    await expectEpubFailure(syntheticEpubFixture({ chapterOne: "<html><body><p>broken</body>" }), "INVALID_XHTML");
    await expectEpubFailure(syntheticEpubFixture({ chapterOne: "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><h1>빈 장</h1></body></html>" }), "EMPTY_CHAPTER");
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
