import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SourceContractError } from "../../src/lib/errors";
import { findExtractor } from "../../src/lib/extractors/extractor";
import { shuba69Extractor } from "../../src/lib/extractors/shuba69.server";

const fixture = readFileSync(
  join(process.cwd(), "tests/fixtures/69shuba/chapter.html"),
  "utf8",
);
const shortFixture = readFileSync(
  join(process.cwd(), "tests/fixtures/69shuba/chapter-short.html"),
  "utf8",
);
const sourceUrl = new URL("https://www.69shuba.com/txt/48273/32028706.html?from=test#content");

describe("69shuba chapter extractor", () => {
  it("extracts ordered text, identifiers, and absolute navigation URLs", () => {
    const chapter = shuba69Extractor.extractChapter(fixture, sourceUrl);

    expect(chapter).toMatchObject({
      kind: "chapter",
      sourceUrl: sourceUrl.href,
      canonicalUrl: "https://www.69shuba.com/txt/48273/32028706.html",
      siteId: "69shuba",
      bookId: "48273",
      bookTitle: "深海行者",
      chapterId: "32028706",
      chapterNumber: 1,
      chapterTitle: "第一章 鲸落",
      paragraphs: [
        { id: "p-0001", text: "夜色沉入海面，林舟站在甲板尽头，听见远方传来低沉而悠长的鲸鸣。" },
        { id: "p-0002", text: "风把咸涩的水汽送到脸上，他握紧栏杆，想起三年前那场没有归人的远航。" },
        { id: "p-0003", text: "“灯亮了。”身后的少女轻声说。海雾深处，一点金色正沿着浪脊缓缓靠近。" },
      ],
      navigation: {
        previous: {
          url: "https://www.69shuba.com/txt/48273/32028705.html",
          label: "上一章",
        },
        catalog: { url: "https://www.69shuba.com/book/48273", label: "目录" },
        next: {
          url: "https://www.69shuba.com/txt/48273/32028707.html",
          label: "下一章",
        },
      },
    });
  });

  it("does not expose non-content or executable HTML text", () => {
    const serialized = JSON.stringify(shuba69Extractor.extractChapter(fixture, sourceUrl));

    expect(serialized).not.toMatch(/首页|排行榜|广告|恶意脚本|background|框架内容|onclick/);
    expect(serialized).not.toContain("<");
  });

  it("produces stable paragraph IDs and content hashes", () => {
    const first = shuba69Extractor.extractChapter(fixture, sourceUrl);
    const second = shuba69Extractor.extractChapter(fixture, sourceUrl);

    expect(second.paragraphs).toEqual(first.paragraphs);
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects empty or unreasonably short content", () => {
    expect(() => shuba69Extractor.extractChapter(shortFixture, sourceUrl)).toThrowError(
      expect.objectContaining<Partial<SourceContractError>>({ code: "EXTRACTION_FAILED" }),
    );
  });

  it("selects adapters by exact hostname", () => {
    expect(findExtractor(new URL("https://www.69shuba.com/txt/1/2"))).toBe(shuba69Extractor);
    expect(findExtractor(new URL("https://www.69shuba.com.evil.example/txt/1/2"))).toBeUndefined();
  });
});
