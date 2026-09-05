import { describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  parseEpub: vi.fn(),
  openReaderDatabase: vi.fn(),
  createCatalogCache: vi.fn(),
  createLocalEpubLibrary: vi.fn(),
}));

vi.mock("../../src/lib/epub/parse-epub.client", () => ({ parseEpub: dependencies.parseEpub }));
vi.mock("../../src/services/reader-db.client", () => ({ openReaderDatabase: dependencies.openReaderDatabase }));
vi.mock("../../src/services/catalog-cache.client", () => ({ createCatalogCache: dependencies.createCatalogCache }));
vi.mock("../../src/services/local-epub-library.client", () => ({ createLocalEpubLibrary: dependencies.createLocalEpubLibrary }));

import { importLocalEpub } from "../../src/components/home-settings-flow";

describe("local EPUB import", () => {
  it("keeps the database open until archive storage completes", async () => {
    let completeImport: ((value: { ok: true; book: { id: string } }) => void) | undefined;
    const close = vi.fn();
    const database = { close };
    dependencies.parseEpub.mockResolvedValue({ book: {}, chapters: [], catalog: {}, chapterPaths: [] });
    dependencies.openReaderDatabase.mockResolvedValue(database);
    dependencies.createCatalogCache.mockReturnValue({});
    dependencies.createLocalEpubLibrary.mockReturnValue({
      import: vi.fn(() => new Promise((resolve) => { completeImport = resolve; })),
    });

    const result = importLocalEpub(new File(["archive"], "book.epub", { type: "application/epub+zip" }));

    await vi.waitFor(() => expect(dependencies.createLocalEpubLibrary).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();

    completeImport?.({ ok: true, book: { id: "book-id" } });
    await expect(result).resolves.toEqual({ ok: true, book: { id: "book-id" } });
    expect(close).toHaveBeenCalledOnce();
  });
});
