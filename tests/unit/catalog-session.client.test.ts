import { describe, expect, it, vi } from "vitest";

import {
  createCatalogSession,
  filterAndSortCatalogChapters,
} from "../../src/lib/catalog/session.client";
import type { CatalogSource } from "../../src/types/source";

const catalog = (suffix = "catalog"): CatalogSource => ({
  kind: "catalog",
  sourceUrl: `https://www.69shuba.com/book/1/${suffix}`,
  canonicalUrl: "https://www.69shuba.com/book/1/",
  siteId: "69shuba",
  bookId: "1",
  bookTitle: "原始书名",
  chapters: [
    { id: "c3", url: "https://www.69shuba.com/txt/1/3", title: "第三章 归来", number: 3, sourceIndex: 2 },
    { id: "c1", url: "https://www.69shuba.com/txt/1/1", title: "序章", sourceIndex: 0 },
    { id: "c2", url: "https://www.69shuba.com/txt/1/2", title: "第二章 山门", number: 2, sourceIndex: 1 },
  ],
  fetchedAt: "2026-09-04T00:00:00.000Z",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("catalog session", () => {
  it("uses a normalized fresh cache hit without fetching", async () => {
    const cached = catalog();
    const cache = { get: vi.fn(async () => ({ status: "fresh" as const, record: { catalog: cached } })), put: vi.fn() };
    const sourceClient = { fetchCatalog: vi.fn(), fetchChapter: vi.fn() };
    const session = createCatalogSession({ cache: cache as never, sourceClient });

    await session.open("https://www.69shuba.com/book/1/#chapters");

    expect(cache.get).toHaveBeenCalledWith("https://www.69shuba.com/book/1/");
    expect(sourceClient.fetchCatalog).not.toHaveBeenCalled();
    expect(session.getState()).toMatchObject({ status: "ready", catalog: cached, cacheStatus: "fresh" });
  });

  it("refreshes stale data, but preserves it with a safe warning when refresh fails", async () => {
    const cached = catalog("old");
    const cache = { get: vi.fn(async () => ({ status: "stale" as const, record: { catalog: cached } })), put: vi.fn() };
    const sourceClient = { fetchCatalog: vi.fn(async () => { throw new Error("secret upstream body"); }), fetchChapter: vi.fn() };
    const session = createCatalogSession({ cache: cache as never, sourceClient });

    await session.open(cached.canonicalUrl);

    expect(sourceClient.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      status: "ready",
      catalog: cached,
      cacheStatus: "stale",
      warning: "목차를 새로 불러오지 못해 저장된 목록을 표시합니다.",
    });
    expect(JSON.stringify(session.getState())).not.toContain("secret upstream body");
  });

  it("fetches and caches a miss, while rejecting invalid network output", async () => {
    const fresh = catalog("new");
    const cache = { get: vi.fn(async () => ({ status: "miss" as const })), put: vi.fn(async () => undefined) };
    const sourceClient = { fetchCatalog: vi.fn().mockResolvedValueOnce(fresh).mockResolvedValueOnce({ ...fresh, chapters: [] }), fetchChapter: vi.fn() };
    const session = createCatalogSession({ cache: cache as never, sourceClient });

    await session.open(fresh.canonicalUrl);
    expect(cache.put).toHaveBeenCalledWith(fresh);
    expect(session.getState()).toMatchObject({ status: "ready", catalog: fresh, cacheStatus: "refreshed" });

    await session.open("https://www.69shuba.com/book/2/");
    expect(session.getState()).toMatchObject({ status: "error", message: "목차를 불러올 수 없습니다." });
  });

  it("aborts an earlier request and ignores its late result", async () => {
    const first = deferred<CatalogSource>();
    const second = catalog("second");
    const cache = { get: vi.fn(async () => ({ status: "miss" as const })), put: vi.fn(async () => undefined) };
    const sourceClient = {
      fetchCatalog: vi.fn((url: string, signal: AbortSignal) => {
        void signal;
        return url.includes("/1/") ? first.promise : Promise.resolve(second);
      }),
      fetchChapter: vi.fn(),
    };
    const session = createCatalogSession({ cache: cache as never, sourceClient });

    const oldOpen = session.open("https://www.69shuba.com/book/1/");
    await Promise.resolve();
    const newOpen = session.open("https://www.69shuba.com/book/2/");
    first.resolve(catalog("late"));
    await Promise.all([oldOpen, newOpen]);

    expect(sourceClient.fetchCatalog.mock.calls[0]?.[1].aborted).toBe(true);
    expect(session.getState()).toMatchObject({ status: "ready", catalog: second });
  });
});

describe("catalog filtering", () => {
  it("searches number or original title and sorts deterministically without mutation", () => {
    const source = catalog();
    const before = structuredClone(source.chapters);
    expect(filterAndSortCatalogChapters(source.chapters, "2", "ascending").map(({ id }) => id)).toEqual(["c2"]);
    expect(filterAndSortCatalogChapters(source.chapters, "山门", "ascending").map(({ id }) => id)).toEqual(["c2"]);
    expect(filterAndSortCatalogChapters(source.chapters, "", "ascending").map(({ id }) => id)).toEqual(["c1", "c2", "c3"]);
    expect(filterAndSortCatalogChapters(source.chapters, "", "descending").map(({ id }) => id)).toEqual(["c3", "c2", "c1"]);
    expect(source.chapters).toEqual(before);
  });
});
