import "server-only";

import { ChapterSourceSchema, type ChapterSource } from "../../types/source";
import { SourceContractError } from "../errors";
import { findExtractor, type SiteExtractor } from "../extractors/extractor";
import {
  fetchSourceHtml,
  type FetchSourceDependencies,
  type FetchedSourceHtml,
} from "./fetch-source.server";

export type ChapterSourceDependencies = {
  fetchSource?: (url: string) => Promise<FetchedSourceHtml>;
  fetchDependencies?: FetchSourceDependencies;
  findExtractor?: (url: URL) => SiteExtractor | undefined;
};

export async function loadChapterSource(
  url: string,
  dependencies: ChapterSourceDependencies = {},
): Promise<ChapterSource> {
  const selectExtractor = dependencies.findExtractor ?? findExtractor;
  const source = dependencies.fetchSource
    ? await dependencies.fetchSource(url)
    : await fetchSourceHtml(url, dependencies.fetchDependencies);
  const fetchedUrl = new URL(source.url);
  const extractor = selectExtractor(fetchedUrl);

  if (!extractor) {
    throw new SourceContractError("UNSUPPORTED_SITE", "No extractor supports source URL");
  }

  try {
    return ChapterSourceSchema.parse(extractor.extractChapter(source.html, fetchedUrl));
  } catch (error) {
    if (error instanceof SourceContractError) throw error;
    throw new SourceContractError("EXTRACTION_FAILED", "Extracted chapter failed validation");
  }
}
