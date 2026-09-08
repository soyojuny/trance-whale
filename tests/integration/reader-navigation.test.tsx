import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ReaderNavigation, {
  type ReaderNavigationRuntime,
} from "../../src/components/reader/reader-navigation.client";
import type { CatalogSessionState } from "../../src/lib/catalog/session.client";
import type { ReaderSessionState } from "../../src/lib/reader/session.client";
import { DEFAULT_READER_SETTINGS, DEFAULT_TRANSLATION_SETTINGS, type LastReadingPosition } from "../../src/types/storage";
import type { ChapterSource } from "../../src/types/source";
import { createLocalEpubLocator } from "../../src/lib/epub/locator.client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
});

const chapter = (id: string, navigation: ChapterSource["navigation"] = {}): ChapterSource => ({
  kind: "chapter",
  sourceUrl: `https://www.69shuba.com/txt/1/${id}`,
  canonicalUrl: `https://www.69shuba.com/txt/1/${id}`,
  siteId: "69shuba",
  chapterId: id,
  chapterTitle: `제${id}화`,
  paragraphs: [{ id: "p1", text: "원문" }],
  navigation,
  contentHash: id.padEnd(64, "0"),
  fetchedAt: "2026-09-04T00:00:00.000Z",
});

function complete(source: ChapterSource): ReaderSessionState {
  return {
    status: "complete",
    chapter: source,
    translations: [{ id: "p1", text: "번역문" }],
    completedParagraphs: 1,
    totalParagraphs: 1,
    failedChunkIds: [],
    cache: "miss",
  };
}

function runtime(initialPosition: { canonicalUrl: string; scrollPosition: number; updatedAt: string } | null = null) {
  let publishReader: (state: ReaderSessionState) => void = () => undefined;
  let publishCatalog: (state: CatalogSessionState) => void = () => undefined;
  const readerSession = {
    getState: vi.fn(() => ({ status: "idle" as const })),
    openChapter: vi.fn(async () => undefined),
    openLocalChapter: vi.fn(async () => undefined),
    cancel: vi.fn(),
    forceReload: vi.fn(async () => undefined),
    forceRetranslate: vi.fn(async () => undefined),
    retryFailedTranslation: vi.fn(async () => undefined),
  };
  const catalogSession = {
    getState: vi.fn(() => ({ status: "idle" as const })),
    open: vi.fn(async () => undefined),
    cancel: vi.fn(),
  };
  const preferences = {
    loadPreferences: vi.fn(() => ({
      translation: { ...DEFAULT_TRANSLATION_SETTINGS },
      reader: { ...DEFAULT_READER_SETTINGS },
    })),
    savePreferences: vi.fn(() => ({ ok: true as const })),
    loadReadingPosition: vi.fn(() => initialPosition),
    saveReadingPosition: vi.fn((_position: LastReadingPosition) => {
      void _position;
      return { ok: true as const };
    }),
  };
  const value: ReaderNavigationRuntime = {
    readerSession,
    catalogSession,
    preferences,
    subscribeReader(listener) { publishReader = listener; },
    subscribeCatalog(listener) { publishCatalog = listener; },
    close: vi.fn(),
  };
  return { value, readerSession, catalogSession, preferences, publishReader: (state: ReaderSessionState) => act(() => publishReader(state)), publishCatalog: (state: CatalogSessionState) => act(() => publishCatalog(state)) };
}

describe("reader navigation and position", () => {
  it("opens settings from the mobile toolbar, saves changes, and returns focus on close", async () => {
    const testRuntime = runtime();
    render(<ReaderNavigation initialUrl={chapter("1").sourceUrl} runtime={testRuntime.value} />);
    testRuntime.publishReader(complete(chapter("1")));
    const trigger = screen.getByRole("button", { name: "읽기 및 번역 설정 열기" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "읽기 및 번역 설정" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("나만의 번역 지시"), { target: { value: "말투 유지" } });
    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(testRuntime.preferences.savePreferences).toHaveBeenCalledWith(expect.objectContaining({
      translation: expect.objectContaining({ userPrompt: "말투 유지" }),
    }));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "설정 닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("hides tools while scrolling down, ignores jitter, and shows them scrolling up or at either end", () => {
    const testRuntime = runtime();
    render(<ReaderNavigation initialUrl={chapter("1").sourceUrl} runtime={testRuntime.value} />);
    testRuntime.publishReader(complete(chapter("1")));
    const toolbar = screen.getByRole("navigation", { name: "모바일 독서 도구" });
    const scroll = (top: number) => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: top });
      fireEvent.scroll(window);
    };
    expect(toolbar).not.toHaveAttribute("inert");
    scroll(100);
    expect(toolbar).toHaveAttribute("inert");
    scroll(98);
    expect(toolbar).toHaveAttribute("inert");
    scroll(80);
    expect(toolbar).not.toHaveAttribute("inert");
    scroll(160);
    expect(toolbar).toHaveAttribute("inert");
    scroll(3000);
    expect(toolbar).not.toHaveAttribute("inert");
    scroll(0);
    expect(toolbar).not.toHaveAttribute("inert");
    scroll(-20);
    expect(toolbar).not.toHaveAttribute("inert");
    scroll(100);
    testRuntime.publishReader(complete(chapter("2")));
    expect(toolbar).not.toHaveAttribute("inert");
  });

  it("keeps the mobile toolbar available while settings are open", () => {
    const testRuntime = runtime();
    render(<ReaderNavigation initialUrl={chapter("1").sourceUrl} runtime={testRuntime.value} />);
    testRuntime.publishReader(complete(chapter("1")));
    fireEvent.click(screen.getByRole("button", { name: "읽기 및 번역 설정 열기" }));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 100 });
    fireEvent.scroll(window);
    expect(screen.getByRole("navigation", { name: "모바일 독서 도구" })).not.toHaveAttribute("inert");
  });

  it("uses one encoded internal route for previous, next, catalog, mobile, and home commands", async () => {
    const testRuntime = runtime();
    const navigate = vi.fn();
    const current = chapter("2", {
      previous: { url: "https://www.69shuba.com/txt/1/1?a=b", label: "이전" },
      catalog: { url: "https://www.69shuba.com/book/1/", label: "목차" },
      next: { url: "https://www.69shuba.com/txt/1/3?x=y", label: "다음" },
    });
    const { container } = render(<ReaderNavigation initialUrl={current.sourceUrl} navigate={navigate} runtime={testRuntime.value} />);
    testRuntime.publishReader(complete(current));

    fireEvent.click(screen.getAllByRole("button", { name: /이전 장/ })[0]);
    expect(navigate).toHaveBeenLastCalledWith(`/read?url=${encodeURIComponent(current.navigation.previous!.url)}`);
    fireEvent.click(screen.getAllByRole("button", { name: /다음 장/ }).at(-1)!);
    expect(navigate).toHaveBeenLastCalledWith(`/read?url=${encodeURIComponent(current.navigation.next!.url)}`);

    fireEvent.click(screen.getByRole("button", { name: "목차 열기" }));
    expect(testRuntime.catalogSession.open).toHaveBeenCalledWith(current.navigation.catalog!.url);
    testRuntime.publishCatalog({
      status: "ready",
      cacheStatus: "fresh",
      catalog: {
        kind: "catalog", sourceUrl: current.navigation.catalog!.url, canonicalUrl: current.navigation.catalog!.url,
        siteId: "69shuba", bookTitle: "작품", fetchedAt: current.fetchedAt,
        chapters: [{ id: "c4", url: "https://www.69shuba.com/txt/1/4?q=z", title: "제4화", sourceIndex: 0 }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /제4화/ }));
    expect(navigate).toHaveBeenLastCalledWith("/read?url=https%3A%2F%2Fwww.69shuba.com%2Ftxt%2F1%2F4%3Fq%3Dz");
    fireEvent.click(screen.getByRole("button", { name: "홈으로 이동" }));
    expect(navigate).toHaveBeenLastCalledWith("/");
    expect(container.querySelector("a[href^='http'], iframe")).toBeNull();
  });

  it("cancels the old session and opens only the URL supplied by App Router history state", async () => {
    const testRuntime = runtime();
    const { rerender } = render(<ReaderNavigation initialUrl="https://www.69shuba.com/txt/1/1" runtime={testRuntime.value} navigate={vi.fn()} />);
    await waitFor(() => expect(testRuntime.readerSession.openChapter).toHaveBeenCalledWith("https://www.69shuba.com/txt/1/1"));
    testRuntime.publishReader(complete(chapter("1")));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 180 });

    rerender(<ReaderNavigation initialUrl="https://www.69shuba.com/txt/1/2" runtime={testRuntime.value} navigate={vi.fn()} />);
    await waitFor(() => expect(testRuntime.readerSession.openChapter).toHaveBeenLastCalledWith("https://www.69shuba.com/txt/1/2"));
    expect(testRuntime.readerSession.cancel).toHaveBeenCalled();
    testRuntime.publishReader(complete(chapter("2")));
    const firstChapterWrites = testRuntime.preferences.saveReadingPosition.mock.calls
      .map(([position]) => position)
      .filter((position) => position.canonicalUrl === chapter("1").canonicalUrl);
    expect(firstChapterWrites).toEqual([expect.objectContaining({ scrollPosition: 180 })]);
  });

  it("starts a new chapter at the top and restores only a matching canonical position", () => {
    const saved = { canonicalUrl: "https://www.69shuba.com/txt/1/2", scrollPosition: 420, updatedAt: "2026-09-04T00:00:00.000Z" };
    const testRuntime = runtime(saved);
    const scrollTo = vi.mocked(window.scrollTo);
    render(<ReaderNavigation initialUrl="https://www.69shuba.com/txt/1/2?tracking=1" runtime={testRuntime.value} navigate={vi.fn()} />);

    testRuntime.publishReader(complete(chapter("1")));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "auto" });
    testRuntime.publishReader(complete(chapter("2")));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 420, behavior: "auto" });
  });

  it("throttles scroll writes and flushes the current chapter position on unmount", () => {
    vi.useFakeTimers();
    const testRuntime = runtime();
    const { unmount } = render(<ReaderNavigation initialUrl="https://www.69shuba.com/txt/1/2" runtime={testRuntime.value} navigate={vi.fn()} />);
    testRuntime.publishReader(complete(chapter("2")));
    Object.defineProperty(window, "scrollY", { configurable: true, value: 100 });
    fireEvent.scroll(window);
    Object.defineProperty(window, "scrollY", { configurable: true, value: 220 });
    fireEvent.scroll(window);
    expect(testRuntime.preferences.saveReadingPosition).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(testRuntime.preferences.saveReadingPosition).toHaveBeenCalledTimes(1);
    expect(testRuntime.preferences.saveReadingPosition).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalUrl: chapter("2").canonicalUrl, scrollPosition: 220 }));

    Object.defineProperty(window, "scrollY", { configurable: true, value: 310 });
    unmount();
    expect(testRuntime.preferences.saveReadingPosition).toHaveBeenLastCalledWith(expect.objectContaining({ canonicalUrl: chapter("2").canonicalUrl, scrollPosition: 310 }));
    vi.useRealTimers();
  });

  it("keeps absent previous and next targets disabled in desktop and mobile navigation", () => {
    const testRuntime = runtime();
    render(<ReaderNavigation initialUrl="https://www.69shuba.com/txt/1/1" runtime={testRuntime.value} navigate={vi.fn()} />);
    testRuntime.publishReader(complete(chapter("1")));

    expect(screen.getAllByRole("button", { name: "이전 장 없음" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "다음 장 없음" })).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: /장 없음/ })) expect(button).toBeDisabled();
    expect(screen.getByRole("navigation", { name: "모바일 독서 도구" })).toBeInTheDocument();
  });

  it("opens local EPUB URLs without a source API request and keeps chapter navigation internal", async () => {
    const bookId = "a".repeat(64);
    const testRuntime = runtime();
    const navigate = vi.fn();
    const current = {
      ...chapter("2", {
        previous: { url: createLocalEpubLocator(bookId, 0), label: "첫 장" },
        next: { url: createLocalEpubLocator(bookId, 2), label: "셋째 장" },
      }),
      sourceUrl: createLocalEpubLocator(bookId, 1),
      canonicalUrl: createLocalEpubLocator(bookId, 1),
      siteId: "local-epub",
      bookId,
    } as ChapterSource;
    render(<ReaderNavigation initialUrl={current.canonicalUrl} navigate={navigate} runtime={testRuntime.value} />);

    await waitFor(() => expect(testRuntime.readerSession.openLocalChapter).toHaveBeenCalledWith(bookId, 1));
    expect(testRuntime.readerSession.openChapter).not.toHaveBeenCalled();
    testRuntime.publishReader(complete(current));
    expect(screen.getAllByRole("button", { name: "목차 없음" })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /다음 장/ })[0]);
    expect(navigate).toHaveBeenCalledWith(`/read?book=${bookId}&chapter=2`);
  });

  it("opens the stored local EPUB catalog without asking the source API", async () => {
    const bookId = "a".repeat(64);
    const testRuntime = runtime();
    const openLocalCatalog = vi.fn(async () => ({
      kind: "catalog" as const,
      sourceUrl: createLocalEpubLocator(bookId, 0),
      canonicalUrl: createLocalEpubLocator(bookId, 0),
      siteId: "local-epub",
      bookId,
      bookTitle: "합성 책",
      chapters: [{ id: "chapter-1", url: createLocalEpubLocator(bookId, 1), title: "둘째 장", sourceIndex: 1 }],
      fetchedAt: "2026-09-05T00:00:00.000Z",
    }));
    testRuntime.value.openLocalCatalog = openLocalCatalog;
    const current = {
      ...chapter("1", { catalog: { url: createLocalEpubLocator(bookId, 0) } }),
      sourceUrl: createLocalEpubLocator(bookId, 1),
      canonicalUrl: createLocalEpubLocator(bookId, 1),
      siteId: "local-epub",
      bookId,
    } as ChapterSource;
    render(<ReaderNavigation initialUrl={current.canonicalUrl} runtime={testRuntime.value} navigate={vi.fn()} />);
    testRuntime.publishReader(complete(current));

    fireEvent.click(screen.getByRole("button", { name: "목차 열기 (상단)" }));
    await waitFor(() => expect(openLocalCatalog).toHaveBeenCalledWith(bookId));
    expect(testRuntime.catalogSession.open).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: /목차/ })).toBeInTheDocument();
  });
});
