import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  collectShuba69Catalog,
  shuba69Extractor,
} from "../../src/lib/extractors/shuba69.server";

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), `tests/fixtures/69shuba/${name}`), "utf8");
}

describe("69shuba catalog extractor", () => {
  it("extracts the book and ordered chapter metadata from one page", () => {
    const sourceUrl = new URL("https://www.69shuba.com/book/48273/?from=reader#catalog");
    const catalog = shuba69Extractor.extractCatalog(fixture("catalog-single.html"), sourceUrl);

    expect(catalog).toMatchObject({
      kind: "catalog",
      sourceUrl: sourceUrl.href,
      canonicalUrl: "https://www.69shuba.com/book/48273",
      siteId: "69shuba",
      bookId: "48273",
      bookTitle: "深海行者",
      chapters: [
        {
          id: "chapter-32028706",
          url: "https://www.69shuba.com/txt/48273/32028706.html",
          title: "第一章 鲸落",
          number: 1,
          sourceIndex: 0,
        },
        {
          id: "chapter-32028707",
          url: "https://www.69shuba.com/txt/48273/32028707.html",
          title: "第2章 雾灯",
          number: 2,
          sourceIndex: 1,
        },
      ],
    });
  });

  it("keeps source order and removes normalized URL duplicates across pages", async () => {
    const pages = new Map([
      ["https://www.69shuba.com/book/48273/2.html", fixture("catalog-page-2.html")],
      ["https://www.69shuba.com/book/48273/3.html", fixture("catalog-page-3.html")],
    ]);
    const loadPage = vi.fn(async (url: URL) => pages.get(url.href) ?? "");

    const catalog = await collectShuba69Catalog(
      fixture("catalog-page-1.html"),
      new URL("https://www.69shuba.com/book/48273/"),
      loadPage,
      5,
    );

    expect(catalog.chapters.map(({ id, sourceIndex }) => ({ id, sourceIndex }))).toEqual([
      { id: "chapter-32028706", sourceIndex: 0 },
      { id: "chapter-32028707", sourceIndex: 1 },
      { id: "chapter-32028708", sourceIndex: 2 },
      { id: "chapter-32028709", sourceIndex: 3 },
    ]);
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("stops at the page limit without following another page", async () => {
    const loadPage = vi.fn(async () => fixture("catalog-page-2.html"));

    const catalog = await collectShuba69Catalog(
      fixture("catalog-page-1.html"),
      new URL("https://www.69shuba.com/book/48273/"),
      loadPage,
      2,
    );

    expect(catalog.chapters).toHaveLength(3);
    expect(loadPage).toHaveBeenCalledTimes(1);
  });

  it("does not expose scripts, styles, advertisements, or HTML", () => {
    const catalog = shuba69Extractor.extractCatalog(
      fixture("catalog-single.html"),
      new URL("https://www.69shuba.com/book/48273/"),
    );
    const serialized = JSON.stringify(catalog);

    expect(serialized).not.toMatch(/首页|排行榜|广告|恶意脚本|display/);
    expect(serialized).not.toContain("<");
  });
});
