import "server-only";

import { createHash } from "node:crypto";

import { load, type CheerioAPI } from "cheerio";

import type { CatalogSource, ChapterSource, NavigationTarget } from "../../types/source";
import { SourceContractError } from "../errors";
import type { SiteExtractor } from "./extractor";

const HOSTNAME = "www.69shuba.com";
const MINIMUM_CONTENT_LENGTH = 100;
const CHAPTER_PATH = /^\/txt\/(\d+)\/(\d+)(?:\.html)?\/?$/;
const CHAPTER_NUMBER = /第\s*([零〇一二两三四五六七八九十百千万\d]+)\s*章/;

const selectors = {
  title: "h1",
  breadcrumbBook: ".txtnav > a[href*='/book/']",
  content: "#content",
  paragraphs: ":scope > p",
  advertisement: ".contentadv, .ad, .adsbygoogle",
  previous: ".page1 #prev, .page1 a:contains('上一章')",
  catalog: ".page1 #index, .page1 a:contains('目录')",
  next: ".page1 #next, .page1 a:contains('下一章')",
} as const;

function cleanText(text: string): string {
  return text.replace(/[\u00a0\s]+/g, " ").trim();
}

function parseChapterNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);

  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1_000, 万: 10_000 };
  let total = 0;
  let section = 0;
  let digit = 0;

  for (const character of value) {
    if (character in digits) {
      digit = digits[character];
      continue;
    }
    const unit = units[character];
    if (!unit) return undefined;
    if (unit === 10_000) {
      section = (section + digit) * unit;
      total += section;
      section = 0;
    } else {
      section += (digit || 1) * unit;
    }
    digit = 0;
  }

  const result = total + section + digit;
  return result > 0 ? result : undefined;
}

function normalizeUrl(url: URL): URL {
  const normalized = new URL(url.href);
  normalized.search = "";
  normalized.hash = "";
  if (normalized.pathname.length > 1) normalized.pathname = normalized.pathname.replace(/\/$/, "");
  return normalized;
}

function navigationTarget(
  $: CheerioAPI,
  selector: string,
  sourceUrl: URL,
): NavigationTarget | undefined {
  const anchor = $(selector).first();
  const href = anchor.attr("href");
  if (!href) return undefined;

  let target: URL;
  try {
    target = normalizeUrl(new URL(href, sourceUrl));
  } catch {
    return undefined;
  }

  if (
    target.protocol !== "https:" ||
    target.hostname !== HOSTNAME ||
    target.port !== "" ||
    target.username !== "" ||
    target.password !== ""
  ) {
    return undefined;
  }

  const label = cleanText(anchor.text());
  return label ? { url: target.href, label } : { url: target.href };
}

function extractChapter(html: string, sourceUrl: URL): ChapterSource {
  if (!shuba69Extractor.matches(sourceUrl)) {
    throw new SourceContractError("EXTRACTION_FAILED", "URL does not match 69shuba chapter format");
  }

  const $ = load(html);
  $(selectors.content).find(`script, style, iframe, ${selectors.advertisement}`).remove();

  const paragraphs = $(selectors.content)
    .find(selectors.paragraphs)
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean)
    .map((text, index) => ({ id: `p-${String(index + 1).padStart(4, "0")}`, text }));
  const normalizedContent = paragraphs.map(({ text }) => text).join("\n");

  if (normalizedContent.length < MINIMUM_CONTENT_LENGTH) {
    throw new SourceContractError("EXTRACTION_FAILED", "Chapter content is empty or too short");
  }

  const pathMatch = sourceUrl.pathname.match(CHAPTER_PATH);
  const chapterTitle = cleanText($(selectors.title).first().text());
  if (!chapterTitle) {
    throw new SourceContractError("EXTRACTION_FAILED", "Chapter title is missing");
  }

  const chapterNumberMatch = chapterTitle.match(CHAPTER_NUMBER);
  const chapterNumber = chapterNumberMatch
    ? parseChapterNumber(chapterNumberMatch[1])
    : undefined;
  const bookTitle = cleanText($(selectors.breadcrumbBook).first().text());

  return {
    kind: "chapter",
    sourceUrl: sourceUrl.href,
    canonicalUrl: normalizeUrl(sourceUrl).href,
    siteId: shuba69Extractor.id,
    bookId: pathMatch?.[1],
    ...(bookTitle ? { bookTitle } : {}),
    chapterId: pathMatch?.[2],
    ...(chapterNumber ? { chapterNumber } : {}),
    chapterTitle,
    paragraphs,
    navigation: {
      previous: navigationTarget($, selectors.previous, sourceUrl),
      catalog: navigationTarget($, selectors.catalog, sourceUrl),
      next: navigationTarget($, selectors.next, sourceUrl),
    },
    contentHash: createHash("sha256").update(normalizedContent, "utf8").digest("hex"),
    fetchedAt: new Date().toISOString(),
  };
}

export const shuba69Extractor: SiteExtractor = {
  id: "69shuba",
  hosts: [HOSTNAME],
  matches(url) {
    return url.hostname === HOSTNAME;
  },
  normalizeUrl,
  extractChapter,
  extractCatalog(): CatalogSource {
    throw new SourceContractError("EXTRACTION_FAILED", "Catalog extraction is not implemented");
  },
};
