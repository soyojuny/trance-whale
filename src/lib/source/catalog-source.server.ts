import "server-only";

import { CatalogSourceSchema, type CatalogSource } from "../../types/source";
import { SourceContractError } from "../errors";
import { findExtractor, type SiteExtractor } from "../extractors/extractor";
import { collectShuba69Catalog } from "../extractors/shuba69.server";
import {
  fetchSourceHtml,
  type FetchSourceDependencies,
  type FetchedSourceHtml,
} from "./fetch-source.server";

export const MAX_CATALOG_PAGES = 5;

export type CatalogSourceDependencies = {
  fetchSource?: (url: string) => Promise<FetchedSourceHtml>;
  fetchDependencies?: FetchSourceDependencies;
  findExtractor?: (url: URL) => SiteExtractor | undefined;
  maxPages?: number;
};

export async function loadCatalogSource(
  url: string,
  dependencies: CatalogSourceDependencies = {},
): Promise<CatalogSource> {
  const fetchPage = (pageUrl: string) =>
    dependencies.fetchSource
      ? dependencies.fetchSource(pageUrl)
      : fetchSourceHtml(pageUrl, dependencies.fetchDependencies);
  const initialSource = await fetchPage(url);
  const sourceUrl = new URL(initialSource.url);
  const extractor = (dependencies.findExtractor ?? findExtractor)(sourceUrl);

  if (!extractor) {
    throw new SourceContractError("UNSUPPORTED_SITE", "No extractor supports source URL");
  }
  if (extractor.id !== "69shuba") {
    throw new SourceContractError("UNSUPPORTED_SITE", "Catalog collection is not supported");
  }

  try {
    const catalog = await collectShuba69Catalog(
      initialSource.html,
      sourceUrl,
      async (nextUrl) => (await fetchPage(nextUrl.href)).html,
      dependencies.maxPages ?? MAX_CATALOG_PAGES,
      true,
    );
    return CatalogSourceSchema.parse(catalog);
  } catch (error) {
    if (error instanceof SourceContractError) throw error;
    throw new SourceContractError("EXTRACTION_FAILED", "Extracted catalog failed validation");
  }
}
