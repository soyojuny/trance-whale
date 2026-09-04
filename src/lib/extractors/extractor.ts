import type { CatalogSource, ChapterSource } from "../../types/source";

import { shuba69Extractor } from "./shuba69.server";

export interface SiteExtractor {
  readonly id: string;
  readonly hosts: readonly string[];
  matches(url: URL): boolean;
  normalizeUrl(url: URL): URL;
  extractChapter(html: string, sourceUrl: URL): ChapterSource;
  extractCatalog(html: string, sourceUrl: URL): CatalogSource;
}

const extractors: readonly SiteExtractor[] = [shuba69Extractor];

export function findExtractor(url: URL): SiteExtractor | undefined {
  return extractors.find(
    (extractor) => extractor.hosts.includes(url.hostname) && extractor.matches(url),
  );
}
