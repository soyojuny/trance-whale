import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ReaderView from "../../src/components/reader/reader-view";
import type { ReaderSessionState } from "../../src/lib/reader/session.client";
import type { ChapterSource } from "../../src/types/source";
import type { ReaderSettings } from "../../src/types/storage";

const chapter: ChapterSource = {
  kind: "chapter",
  sourceUrl: "https://www.69shuba.com/txt/1/2",
  canonicalUrl: "https://www.69shuba.com/txt/1/2",
  siteId: "69shuba",
  bookTitle: "검선독존",
  chapterNumber: 128,
  chapterTitle: "<img src=x onerror=alert(1)> 산문으로 돌아오다",
  paragraphs: [
    { id: "p1", text: "<script>window.evil = true</script> 첫 문단" },
    { id: "p2", text: "第二段" },
    { id: "p3", text: "第三段" },
  ],
  navigation: {
    previous: { url: "https://www.69shuba.com/txt/1/1", label: "제127화 오랜 약속" },
    catalog: { url: "https://www.69shuba.com/book/1/", label: "목차" },
    next: { url: "https://www.69shuba.com/txt/1/3", label: "제129화 손님" },
  },
  contentHash: "a".repeat(64),
  fetchedAt: "2026-09-04T00:00:00.000Z",
};

const settings: ReaderSettings = { viewMode: "translation", fontSize: 19, lineHeight: 2 };

function contentState(status: "parsing_response" | "checking_cache" | "translating" | "complete" | "partial_failure"): ReaderSessionState {
  const content = {
    chapter,
    translations: [
      { id: "p1", text: "첫 번째 번역" },
      { id: "p3", text: "세 번째 번역" },
    ],
    completedParagraphs: 2,
    totalParagraphs: 3,
    failedChunkIds: status === "partial_failure" ? ["chunk-2"] : [],
  };
  if (status === "complete") return { status, cache: "miss", ...content };
  if (status === "partial_failure") return { status, errors: [], ...content };
  return { status, ...content };
}

describe("ReaderView", () => {
  it.each([
    [{ status: "fetching_source", url: chapter.sourceUrl } as ReaderSessionState, "페이지 불러오는 중"],
    [contentState("parsing_response"), "본문 분석 중"],
    [contentState("checking_cache"), "본문 분석 중"],
    [contentState("translating"), "번역 중"],
    [contentState("complete"), "완료"],
  ])("derives the visible status from the session", (state, label) => {
    render(<ReaderView state={state} settings={settings} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows accessible progress and allows cancellation while translating", () => {
    const onCancel = vi.fn();
    render(<ReaderView state={contentState("translating")} settings={settings} onCancel={onCancel} />);

    expect(screen.getByText("2 / 3 문단")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "번역 진행률" })).toHaveAttribute("aria-valuenow", "67");
    fireEvent.click(screen.getByRole("button", { name: "번역 취소" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each(["translation", "original", "both"] as const)("pairs paragraphs by ID in %s mode", (viewMode) => {
    render(<ReaderView state={contentState("translating")} settings={{ ...settings, viewMode }} />);
    const paragraphs = screen.getAllByTestId(/^paragraph-/);
    expect(paragraphs.map((node) => node.dataset.testid)).toEqual(["paragraph-p1", "paragraph-p2", "paragraph-p3"]);

    const first = within(paragraphs[0]);
    const second = within(paragraphs[1]);
    if (viewMode !== "translation") expect(first.getByText(/<script>/)).toBeInTheDocument();
    if (viewMode !== "original") expect(first.getByText("첫 번째 번역")).toBeInTheDocument();
    if (viewMode === "both") {
      expect(paragraphs[0].textContent?.indexOf("<script>")).toBeLessThan(paragraphs[0].textContent?.indexOf("첫 번째 번역") ?? 0);
    }
    if (viewMode === "original") expect(second.getByText("第二段")).toBeInTheDocument();
    else expect(second.getByLabelText("p2 번역 대기 중")).toBeInTheDocument();
  });

  it("replaces only pending placeholders when progressive translations arrive", () => {
    const { rerender } = render(<ReaderView state={contentState("translating")} settings={settings} />);
    expect(screen.getByText("첫 번째 번역")).toBeInTheDocument();
    expect(screen.getByLabelText("p2 번역 대기 중")).toBeInTheDocument();

    const next = contentState("translating");
    if (!("chapter" in next)) throw new Error("chapter state expected");
    next.translations = [...next.translations, { id: "p2", text: "두 번째 번역" }];
    next.completedParagraphs = 3;
    rerender(<ReaderView state={next} settings={settings} />);

    expect(screen.getByText("첫 번째 번역")).toBeInTheDocument();
    expect(screen.getByText("두 번째 번역")).toBeInTheDocument();
    expect(screen.queryByLabelText("p2 번역 대기 중")).not.toBeInTheDocument();
  });

  it("keeps successful text, shows unique safe failure reasons, and exposes retry when eligible", () => {
    const onRetryFailed = vi.fn();
    const state = contentState("partial_failure");
    if (state.status !== "partial_failure") throw new Error("partial failure state expected");
    state.errors = [
      { code: "QUOTA_EXCEEDED", message: "Gemini API 할당량이 소진되었습니다.", retryable: true },
      { code: "TRANSLATION_BLOCKED", message: "안전 정책으로 번역할 수 없습니다.", retryable: false },
    ];
    render(<ReaderView state={state} settings={settings} onRetryFailed={onRetryFailed} />);

    expect(screen.getByText("첫 번째 번역")).toBeInTheDocument();
    expect(screen.getByText("번역하지 못한 문단이 1개 있습니다.")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Gemini API 할당량이 소진되었습니다.");
    expect(screen.getByRole("alert")).toHaveTextContent("안전 정책으로 번역할 수 없습니다.");
    expect(screen.getByTestId("paragraph-p2")).toHaveTextContent("번역 실패");
    fireEvent.click(screen.getByRole("button", { name: "실패한 문단 다시 번역" }));
    expect(onRetryFailed).toHaveBeenCalledOnce();
  });

  it("does not expose a retry action or raw errors for non-retryable partial failures", () => {
    const secret = "AIza-view-secret";
    const state = contentState("partial_failure");
    if (state.status !== "partial_failure") throw new Error("partial failure state expected");
    state.errors = [{
      code: "TRANSLATION_BLOCKED",
      message: `${secret} raw upstream body`,
      retryable: false,
    }];
    render(<ReaderView state={state} settings={settings} />);

    expect(screen.getByRole("alert")).toHaveTextContent("다시 번역할 수 없는 실패가 있습니다.");
    expect(screen.getByRole("alert")).toHaveTextContent("안전 정책으로 번역할 수 없습니다.");
    expect(screen.queryByRole("button", { name: "실패한 문단 다시 번역" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(secret);
    expect(document.body.textContent).not.toContain("raw upstream body");
  });

  it("preserves completed paragraphs and announces a partial retry while it is running", () => {
    const state = contentState("translating");
    if (state.status !== "translating") throw new Error("translating state expected");
    state.retryingFailedChunks = true;
    render(<ReaderView state={state} settings={settings} />);

    expect(screen.getByText("첫 번째 번역")).toBeInTheDocument();
    expect(screen.getByTestId("paragraph-p2")).toHaveTextContent("번역 실패");
    expect(screen.getByText("실패한 문단을 다시 번역하는 중입니다.")).toBeInTheDocument();
    expect(screen.getByText("2 / 3 문단")).toBeInTheDocument();
  });

  it("renders hostile source strings as text and applies bounded reader settings", () => {
    const onSettingsChange = vi.fn();
    const { container } = render(
      <ReaderView state={contentState("complete")} settings={{ ...settings, viewMode: "original", fontSize: 24, lineHeight: 2.2 }} onSettingsChange={onSettingsChange} />,
    );
    expect(screen.getByRole("heading", { name: /<img src=x/ })).toBeInTheDocument();
    expect(screen.getByText(/<script>/)).toBeInTheDocument();
    expect(container.querySelector("script, img, iframe, style")).toBeNull();
    expect(screen.getByRole("article")).toHaveStyle({ fontSize: "24px", lineHeight: "2.2" });

    fireEvent.change(screen.getByLabelText("본문 글자 크기"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("본문 줄 간격"), { target: { value: "1.8" } });
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 16 }));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ lineHeight: 1.8 }));
  });

  it("delegates view and internal navigation actions without creating external links", () => {
    const onSettingsChange = vi.fn();
    const onNavigateChapter = vi.fn();
    const onOpenCatalog = vi.fn();
    const { container } = render(<ReaderView state={contentState("complete")} settings={settings} onSettingsChange={onSettingsChange} onNavigateChapter={onNavigateChapter} onOpenCatalog={onOpenCatalog} />);

    fireEvent.click(screen.getByRole("button", { name: "함께 보기" }));
    expect(onSettingsChange).toHaveBeenCalledWith({ ...settings, viewMode: "both" });
    fireEvent.click(screen.getByRole("button", { name: /이전 장/ }));
    expect(onNavigateChapter).toHaveBeenCalledWith(chapter.navigation.previous?.url);
    fireEvent.click(screen.getByRole("button", { name: "목차 열기" }));
    expect(onOpenCatalog).toHaveBeenCalledWith(chapter.navigation.catalog?.url);
    expect(container.querySelector("a[href^='http']")).toBeNull();
  });
});
