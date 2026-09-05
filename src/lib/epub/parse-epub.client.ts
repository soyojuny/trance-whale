import "client-only";

import { inflateSync } from "fflate";

import { SourceContractError } from "../errors";
import {
  LocalEpubBookSchema,
  LocalEpubCatalogSchema,
  LocalEpubChapterSchema,
  type LocalEpubBook,
} from "../../types/epub";
import type { CatalogSource, ChapterSource } from "../../types/source";
import { createLocalEpubLocator } from "./locator.client";

export const EPUB_LIMITS = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 2_500,
  maxEntryUncompressedBytes: 5 * 1024 * 1024,
  maxTotalUncompressedBytes: 50 * 1024 * 1024,
  maxChapters: 2_000,
  maxParagraphsPerChapter: 10_000,
  maxTotalParagraphs: 300_000,
} as const;

type EpubLimits = { [Limit in keyof typeof EPUB_LIMITS]: number };

export type EpubParserErrorReason =
  | "INVALID_CONTAINER"
  | "ZIP_LIMIT"
  | "INVALID_XML"
  | "INVALID_XHTML"
  | "EMPTY_CHAPTER"
  | "INVALID_TOC"
  | "DRM_PROTECTED"
  | "IMAGE_BASED";

export class EpubParserError extends SourceContractError {
  constructor(readonly reason: EpubParserErrorReason) {
    super(
      reason === "ZIP_LIMIT" ? "EPUB_TOO_LARGE" : reason === "DRM_PROTECTED" || reason === "IMAGE_BASED" ? "EPUB_UNSUPPORTED" : "INVALID_EPUB",
      `EPUB parser rejected ${reason}`,
    );
    this.name = "EpubParserError";
  }
}

type ZipEntry = {
  path: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type PackageItem = {
  id: string;
  path: string;
  mediaType: string;
  properties: string;
};

type ParsedTextChapter = {
  title: string;
  paragraphs: Array<{ id: string; text: string }>;
  contentHash: Promise<string>;
};

type ParsedStructuralDocument = { kind: "structural" };

export type ParsedEpub = {
  book: LocalEpubBook;
  chapters: ChapterSource[];
  catalog: CatalogSource;
  chapterPaths: string[];
};

export type ParseEpubOptions = {
  importedAt?: string;
  limits?: Partial<EpubLimits>;
};

function readUint32(view: DataView, offset: number): number {
  if (offset + 4 > view.byteLength) throw new EpubParserError("INVALID_CONTAINER");
  return view.getUint32(offset, true);
}

function readUint16(view: DataView, offset: number): number {
  if (offset + 2 > view.byteLength) throw new EpubParserError("INVALID_CONTAINER");
  return view.getUint16(offset, true);
}

function normalizeArchivePath(path: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path).replace(/\\/g, "/");
  } catch {
    throw new EpubParserError("INVALID_CONTAINER");
  }
  if (!decoded || decoded.startsWith("/") || decoded.includes("\0")) {
    throw new EpubParserError("INVALID_CONTAINER");
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new EpubParserError("INVALID_CONTAINER");
  }
  return segments.join("/");
}

function resolveArchivePath(basePath: string, href: string, reason: EpubParserErrorReason): string {
  const plainHref = href.split("#", 1)[0];
  if (!plainHref || plainHref.includes("://") || plainHref.includes("?") || plainHref.startsWith("/")) {
    throw new EpubParserError(reason);
  }
  const baseSegments = basePath.split("/").slice(0, -1);
  let hrefSegments: string[];
  try {
    hrefSegments = decodeURIComponent(plainHref).replace(/\\/g, "/").split("/");
  } catch {
    throw new EpubParserError(reason);
  }
  for (const segment of hrefSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (baseSegments.length === 0) throw new EpubParserError(reason);
      baseSegments.pop();
    } else {
      baseSegments.push(segment);
    }
  }
  try {
    return normalizeArchivePath(baseSegments.join("/"));
  } catch {
    throw new EpubParserError(reason);
  }
}

function inspectCentralDirectory(bytes: Uint8Array, limits: EpubLimits): Map<string, ZipEntry> {
  if (bytes.byteLength > limits.maxArchiveBytes) throw new EpubParserError("ZIP_LIMIT");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstEocdOffset = Math.max(0, bytes.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= firstEocdOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new EpubParserError("INVALID_CONTAINER");

  if (readUint16(view, eocdOffset + 4) !== 0 || readUint16(view, eocdOffset + 6) !== 0) {
    throw new EpubParserError("INVALID_CONTAINER");
  }
  const entryCount = readUint16(view, eocdOffset + 10);
  const centralSize = readUint32(view, eocdOffset + 12);
  const centralOffset = readUint32(view, eocdOffset + 16);
  if (entryCount > limits.maxEntries || centralOffset + centralSize > bytes.byteLength) {
    throw new EpubParserError("ZIP_LIMIT");
  }

  const entries = new Map<string, ZipEntry>();
  let totalUncompressedBytes = 0;
  let offset = centralOffset;
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) throw new EpubParserError("INVALID_CONTAINER");
    const flags = readUint16(view, offset + 8);
    const compressionMethod = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const nameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const nameStart = offset + 46;
    const nextOffset = nameStart + nameLength + extraLength + commentLength;
    if (nextOffset > centralOffset + centralSize || flags & 0x1) throw new EpubParserError("INVALID_CONTAINER");

    const rawPath = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    const isDirectory = rawPath.endsWith("/");
    const path = isDirectory ? rawPath.slice(0, -1) : rawPath;
    if (!path) throw new EpubParserError("INVALID_CONTAINER");
    const normalizedPath = normalizeArchivePath(path);
    if (!isDirectory) {
      if (entries.has(normalizedPath)) throw new EpubParserError("INVALID_CONTAINER");
      if (
        uncompressedSize > limits.maxEntryUncompressedBytes
        || totalUncompressedBytes + uncompressedSize > limits.maxTotalUncompressedBytes
      ) {
        throw new EpubParserError("ZIP_LIMIT");
      }
      totalUncompressedBytes += uncompressedSize;
      entries.set(normalizedPath, { path: normalizedPath, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
    }
    offset = nextOffset;
  }
  if (offset !== centralOffset + centralSize) throw new EpubParserError("INVALID_CONTAINER");
  return entries;
}

function extractEntry(bytes: Uint8Array, entry: ZipEntry): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readUint32(view, entry.localHeaderOffset) !== 0x04034b50) throw new EpubParserError("INVALID_CONTAINER");
  const nameLength = readUint16(view, entry.localHeaderOffset + 26);
  const extraLength = readUint16(view, entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) throw new EpubParserError("INVALID_CONTAINER");
  const compressed = bytes.subarray(dataStart, dataEnd);
  try {
    const result = entry.compressionMethod === 0
      ? compressed
      : entry.compressionMethod === 8
        ? inflateSync(compressed)
        : (() => { throw new EpubParserError("INVALID_CONTAINER"); })();
    if (result.byteLength !== entry.uncompressedSize) throw new EpubParserError("INVALID_CONTAINER");
    return result;
  } catch (error) {
    if (error instanceof EpubParserError) throw error;
    throw new EpubParserError("INVALID_CONTAINER");
  }
}

function parseXml(source: string, reason: EpubParserErrorReason): XMLDocument {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) throw new EpubParserError(reason);
  return document;
}

function elementsByName(document: Document, name: string): Element[] {
  return Array.from(document.getElementsByTagName("*")).filter((element) => element.localName === name);
}

function textContent(element: Element | undefined): string | undefined {
  const text = element?.textContent?.replace(/\s+/g, " ").trim();
  return text || undefined;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiredEntry(entries: Map<string, ZipEntry>, path: string, reason: EpubParserErrorReason): ZipEntry {
  const entry = entries.get(path);
  if (!entry) throw new EpubParserError(reason);
  return entry;
}

function parseContainer(bytes: Uint8Array, entries: Map<string, ZipEntry>): string {
  const mimetypeEntry = requiredEntry(entries, "mimetype", "INVALID_CONTAINER");
  if (mimetypeEntry.localHeaderOffset !== 0 || mimetypeEntry.compressionMethod !== 0) {
    throw new EpubParserError("INVALID_CONTAINER");
  }
  const mimetype = new TextDecoder().decode(extractEntry(bytes, mimetypeEntry));
  if (mimetype !== "application/epub+zip") throw new EpubParserError("INVALID_CONTAINER");
  const container = parseXml(
    new TextDecoder().decode(extractEntry(bytes, requiredEntry(entries, "META-INF/container.xml", "INVALID_CONTAINER"))),
    "INVALID_CONTAINER",
  );
  const rootfile = elementsByName(container, "rootfile").find((element) => element.getAttribute("media-type") === "application/oebps-package+xml");
  const fullPath = rootfile?.getAttribute("full-path");
  if (!fullPath) throw new EpubParserError("INVALID_CONTAINER");
  try {
    return normalizeArchivePath(fullPath);
  } catch {
    throw new EpubParserError("INVALID_CONTAINER");
  }
}

function parsePackage(bytes: Uint8Array, entries: Map<string, ZipEntry>, opfPath: string): {
  title: string;
  author?: string;
  language?: string;
  items: Map<string, PackageItem>;
  spine: PackageItem[];
  nav?: PackageItem;
} {
  const opf = parseXml(new TextDecoder().decode(extractEntry(bytes, requiredEntry(entries, opfPath, "INVALID_CONTAINER"))), "INVALID_XML");
  const title = textContent(elementsByName(opf, "title")[0]);
  if (!title) throw new EpubParserError("INVALID_XML");
  const items = new Map<string, PackageItem>();
  for (const item of elementsByName(opf, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type");
    if (!id || !href || !mediaType) throw new EpubParserError("INVALID_XML");
    if (items.has(id)) throw new EpubParserError("INVALID_XML");
    items.set(id, {
      id,
      path: resolveArchivePath(opfPath, href, "INVALID_XML"),
      mediaType,
      properties: item.getAttribute("properties") ?? "",
    });
  }
  const spine = elementsByName(opf, "itemref").map((itemref) => {
    const item = items.get(itemref.getAttribute("idref") ?? "");
    if (!item || item.mediaType !== "application/xhtml+xml") throw new EpubParserError("INVALID_XML");
    return item;
  });
  if (spine.length === 0) throw new EpubParserError("INVALID_XML");
  const nav = Array.from(items.values()).find((item) => item.properties.split(/\s+/).includes("nav"));
  if (nav && nav.mediaType !== "application/xhtml+xml") throw new EpubParserError("INVALID_TOC");
  return {
    title,
    author: textContent(elementsByName(opf, "creator")[0]),
    language: textContent(elementsByName(opf, "language")[0]),
    items,
    spine,
    nav,
  };
}

function isCoverDocument(document: XMLDocument, item: PackageItem): boolean {
  return item.properties.split(/\s+/).includes("cover-image")
    || /(?:^|[-_])cover(?:[-_]|$)/i.test(item.id)
    || /(?:^|[-_])cover(?:[-_]|$)/i.test(item.path)
    || elementsByName(document, "div").some((element) => element.getAttribute("id") === "cover");
}

function parseChapter(bytes: Uint8Array, entry: ZipEntry, fallbackTitle: string, item: PackageItem): ParsedTextChapter | ParsedStructuralDocument {
  const documentBytes = extractEntry(bytes, entry);
  const document = parseXml(new TextDecoder().decode(documentBytes), "INVALID_XHTML");
  const paragraphs = elementsByName(document, "p")
    .map((paragraph) => textContent(paragraph))
    .filter((paragraph): paragraph is string => Boolean(paragraph))
    .map((text, index) => ({ id: `paragraph-${index + 1}`, text }));
  if (paragraphs.length === 0) {
    if (elementsByName(document, "img").length > 0) {
      if (isCoverDocument(document, item)) return { kind: "structural" };
      throw new EpubParserError("IMAGE_BASED");
    }
    if (textContent(elementsByName(document, "h1")[0])) return { kind: "structural" };
    throw new EpubParserError("EMPTY_CHAPTER");
  }
  const title = textContent(elementsByName(document, "h1")[0]) ?? textContent(elementsByName(document, "title")[0]) ?? fallbackTitle;
  return { title, paragraphs, contentHash: sha256(documentBytes) };
}

function navigationTitles(
  bytes: Uint8Array,
  entries: Map<string, ZipEntry>,
  nav: PackageItem | undefined,
  spine: PackageItem[],
  readableSpinePaths: Set<string>,
): Map<string, string> {
  if (!nav) return new Map();
  const document = parseXml(new TextDecoder().decode(extractEntry(bytes, requiredEntry(entries, nav.path, "INVALID_TOC"))), "INVALID_TOC");
  const anchors = elementsByName(document, "a");
  if (anchors.length === 0) throw new EpubParserError("INVALID_TOC");
  const spinePaths = new Set(spine.map((item) => item.path));
  const linkedPaths = new Set<string>();
  const titles = new Map<string, string>();
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    const title = textContent(anchor);
    if (!href || !title) throw new EpubParserError("INVALID_TOC");
    const path = resolveArchivePath(nav.path, href, "INVALID_TOC");
    if (!spinePaths.has(path) || linkedPaths.has(path)) throw new EpubParserError("INVALID_TOC");
    linkedPaths.add(path);
    if (!readableSpinePaths.has(path)) continue;
    titles.set(path, title);
  }
  return titles;
}

export async function parseEpub(file: Blob, options: ParseEpubOptions = {}): Promise<ParsedEpub> {
  const limits = { ...EPUB_LIMITS, ...options.limits };
  if (file.size === 0 || file.size > limits.maxArchiveBytes) throw new EpubParserError("ZIP_LIMIT");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = inspectCentralDirectory(bytes, limits);
  if (entries.has("META-INF/encryption.xml")) throw new EpubParserError("DRM_PROTECTED");
  const opfPath = parseContainer(bytes, entries);
  const packageData = parsePackage(bytes, entries, opfPath);
  if (packageData.spine.length > limits.maxChapters) throw new EpubParserError("ZIP_LIMIT");
  const bookId = await sha256(bytes);
  const parsedSpine = packageData.spine
    .filter((item) => item !== packageData.nav)
    .map((item) => ({
      item,
      parsed: parseChapter(bytes, requiredEntry(entries, item.path, "INVALID_XHTML"), "", item),
    }));
  const readableSpine = parsedSpine.filter((entry): entry is { item: PackageItem; parsed: ParsedTextChapter } => !("kind" in entry.parsed));
  if (readableSpine.length === 0) {
    throw new EpubParserError("EMPTY_CHAPTER");
  }
  const tocTitles = navigationTitles(
    bytes,
    entries,
    packageData.nav,
    packageData.spine,
    new Set(readableSpine.map((entry) => entry.item.path)),
  );
  const importedAt = options.importedAt ?? new Date().toISOString();
  const chapters: ChapterSource[] = await Promise.all(readableSpine.map(async ({ item, parsed }, index) => {
    if (parsed.paragraphs.length > limits.maxParagraphsPerChapter) throw new EpubParserError("ZIP_LIMIT");
    const locator = createLocalEpubLocator(bookId, index);
    return LocalEpubChapterSchema.parse({
      kind: "chapter", sourceUrl: locator, canonicalUrl: locator, siteId: "local-epub", bookId,
      bookTitle: packageData.title, chapterId: `chapter-${index}`, chapterNumber: index + 1,
      chapterTitle: tocTitles.get(item.path) ?? parsed.title, paragraphs: parsed.paragraphs,
      navigation: {
        previous: index > 0 ? { url: createLocalEpubLocator(bookId, index - 1) } : undefined,
        catalog: { url: createLocalEpubLocator(bookId, 0) },
        next: index < packageData.spine.length - 1 ? { url: createLocalEpubLocator(bookId, index + 1) } : undefined,
      },
      contentHash: await parsed.contentHash, fetchedAt: importedAt,
    });
  }));
  if (chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0) > limits.maxTotalParagraphs) {
    throw new EpubParserError("ZIP_LIMIT");
  }
  const book = LocalEpubBookSchema.parse({
    id: bookId, title: packageData.title, author: packageData.author, language: packageData.language,
    sourceByteSize: file.size, importedAt,
    chapters: chapters.map((chapter, index) => ({ index, canonicalUrl: chapter.canonicalUrl, title: chapter.chapterTitle })),
  });
  const catalog = LocalEpubCatalogSchema.parse({
    kind: "catalog", sourceUrl: createLocalEpubLocator(bookId, 0), canonicalUrl: createLocalEpubLocator(bookId, 0),
    siteId: "local-epub", bookId, bookTitle: book.title,
    chapters: book.chapters.map((chapter) => ({ id: `chapter-${chapter.index}`, url: chapter.canonicalUrl, title: chapter.title, number: chapter.index + 1, sourceIndex: chapter.index })),
    fetchedAt: importedAt,
  });
  return { book, chapters, catalog, chapterPaths: readableSpine.map((entry) => entry.item.path) };
}

export async function parseStoredEpubChapter(
  file: Blob,
  bookInput: LocalEpubBook,
  index: number,
  chapterPath: string,
  fetchedAt = new Date().toISOString(),
): Promise<ChapterSource> {
  const book = LocalEpubBookSchema.parse(bookInput);
  const metadata = book.chapters[index];
  if (!metadata || metadata.index !== index || metadata.canonicalUrl !== createLocalEpubLocator(book.id, index)) {
    throw new EpubParserError("INVALID_CONTAINER");
  }
  if (file.size !== book.sourceByteSize || file.size === 0 || file.size > EPUB_LIMITS.maxArchiveBytes) {
    throw new EpubParserError("ZIP_LIMIT");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (await sha256(bytes) !== book.id) throw new EpubParserError("INVALID_CONTAINER");
  const entries = inspectCentralDirectory(bytes, EPUB_LIMITS);
  if (entries.has("META-INF/encryption.xml")) throw new EpubParserError("DRM_PROTECTED");
  const packageData = parsePackage(bytes, entries, parseContainer(bytes, entries));
  if (packageData.spine.length > EPUB_LIMITS.maxChapters) throw new EpubParserError("ZIP_LIMIT");
  const item = packageData.spine.find((candidate) => candidate.path === chapterPath);
  if (!item || item === packageData.nav) throw new EpubParserError("INVALID_CONTAINER");

  const parsed = parseChapter(bytes, requiredEntry(entries, item.path, "INVALID_XHTML"), `Chapter ${index + 1}`, item);
  if ("kind" in parsed || parsed.paragraphs.length > EPUB_LIMITS.maxParagraphsPerChapter) {
    throw new EpubParserError("INVALID_XHTML");
  }

  return LocalEpubChapterSchema.parse({
    kind: "chapter",
    sourceUrl: metadata.canonicalUrl,
    canonicalUrl: metadata.canonicalUrl,
    siteId: "local-epub",
    bookId: book.id,
    bookTitle: book.title,
    chapterId: `chapter-${index}`,
    chapterNumber: index + 1,
    chapterTitle: metadata.title,
    paragraphs: parsed.paragraphs,
    navigation: {
      previous: index > 0 ? { url: createLocalEpubLocator(book.id, index - 1) } : undefined,
      catalog: { url: createLocalEpubLocator(book.id, 0) },
      next: index < book.chapters.length - 1 ? { url: createLocalEpubLocator(book.id, index + 1) } : undefined,
    },
    contentHash: await parsed.contentHash,
    fetchedAt,
  });
}
