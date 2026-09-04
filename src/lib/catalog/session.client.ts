import "client-only";

import type { CatalogCache } from "../../services/catalog-cache.client";
import type { SourceClient } from "../../services/source-client.client";
import {
  CatalogSourceSchema,
  type CatalogChapter,
  type CatalogSource,
} from "../../types/source";

export type CatalogSortOrder = "ascending" | "descending";

export type CatalogSessionState =
  | { status: "idle" }
  | { status: "loading"; staleCatalog?: CatalogSource }
  | {
      status: "ready";
      catalog: CatalogSource;
      cacheStatus: "fresh" | "stale" | "refreshed";
      warning?: string;
    }
  | { status: "error"; message: string };

type CatalogSessionOptions = {
  cache: Pick<CatalogCache, "get" | "put">;
  sourceClient: SourceClient;
  onStateChange?: (state: CatalogSessionState) => void;
};

export type CatalogSession = {
  getState(): CatalogSessionState;
  open(url: string): Promise<void>;
  cancel(): void;
};

export function normalizeCatalogUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function filterAndSortCatalogChapters(
  chapters: readonly CatalogChapter[],
  query: string,
  order: CatalogSortOrder,
): CatalogChapter[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return chapters
    .filter((chapter) => {
      if (!normalizedQuery) return true;
      return chapter.title.toLocaleLowerCase().includes(normalizedQuery)
        || (typeof chapter.number === "number" && String(chapter.number).includes(normalizedQuery));
    })
    .slice()
    .sort((left, right) => {
      const difference = left.sourceIndex - right.sourceIndex;
      if (difference !== 0) return order === "ascending" ? difference : -difference;
      return order === "ascending" ? left.id.localeCompare(right.id) : right.id.localeCompare(left.id);
    });
}

function validCatalog(input: unknown): CatalogSource | null {
  const parsed = CatalogSourceSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function createCatalogSession({
  cache,
  sourceClient,
  onStateChange,
}: CatalogSessionOptions): CatalogSession {
  let state: CatalogSessionState = { status: "idle" };
  let activeRequest = 0;
  let activeController: AbortController | null = null;

  function publish(next: CatalogSessionState): void {
    state = next;
    onStateChange?.(next);
  }

  function cancel(): void {
    activeRequest += 1;
    activeController?.abort();
    activeController = null;
  }

  return {
    getState: () => state,
    cancel,
    async open(inputUrl) {
      cancel();
      const requestId = activeRequest;
      const controller = new AbortController();
      activeController = controller;

      let catalogUrl: string;
      try {
        catalogUrl = normalizeCatalogUrl(inputUrl);
      } catch {
        publish({ status: "error", message: "목차를 불러올 수 없습니다." });
        return;
      }

      let staleCatalog: CatalogSource | undefined;
      try {
        const lookup = await cache.get(catalogUrl);
        if (requestId !== activeRequest) return;
        if (lookup.status !== "miss") {
          const cached = validCatalog(lookup.record.catalog);
          if (cached && lookup.status === "fresh") {
            publish({ status: "ready", catalog: cached, cacheStatus: "fresh" });
            return;
          }
          if (cached) staleCatalog = cached;
        }
      } catch {
        // A cache failure behaves as a miss; the network source remains usable.
      }

      publish({ status: "loading", ...(staleCatalog ? { staleCatalog } : {}) });
      try {
        const result = validCatalog(await sourceClient.fetchCatalog(catalogUrl, controller.signal));
        if (requestId !== activeRequest) return;
        if (!result) throw new Error("invalid catalog");
        await cache.put(result);
        if (requestId !== activeRequest) return;
        publish({ status: "ready", catalog: result, cacheStatus: "refreshed" });
      } catch {
        if (requestId !== activeRequest) return;
        if (staleCatalog) {
          publish({
            status: "ready",
            catalog: staleCatalog,
            cacheStatus: "stale",
            warning: "목차를 새로 불러오지 못해 저장된 목록을 표시합니다.",
          });
          return;
        }
        publish({ status: "error", message: "목차를 불러올 수 없습니다." });
      } finally {
        if (requestId === activeRequest) activeController = null;
      }
    },
  };
}
