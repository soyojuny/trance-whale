import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CatalogSheet from "../../src/components/catalog-sheet";
import type { CatalogSource } from "../../src/types/source";

function makeCatalog(count = 2_100): CatalogSource {
  return {
    kind: "catalog",
    sourceUrl: "https://www.69shuba.com/book/1/",
    canonicalUrl: "https://www.69shuba.com/book/1/",
    siteId: "69shuba",
    bookTitle: "原始书名",
    chapters: Array.from({ length: count }, (_, index) => ({
      id: `c${index + 1}`,
      url: `https://www.69shuba.com/txt/1/${index + 1}`,
      title: `原文标题 ${index + 1}`,
      number: index + 1,
      sourceIndex: index,
    })),
    fetchedAt: "2026-09-04T00:00:00.000Z",
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  render(<CatalogSheet
    catalog={makeCatalog()}
    currentChapterUrl="https://www.69shuba.com/txt/1/5"
    lastReadChapterUrl="https://www.69shuba.com/txt/1/8"
    onClose={onClose}
    onNavigate={onNavigate}
    returnFocusRef={{ current: opener }}
    {...overrides}
  />);
  return { onClose, onNavigate, opener };
}

describe("CatalogSheet", () => {
  it("renders only the viewport range and updates it after scrolling", () => {
    setup();
    const list = screen.getByRole("list", { name: "장 목록" });
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(30);
    expect(screen.getByText("原文标题 1")).toBeInTheDocument();
    expect(screen.queryByText("原文标题 1000")).not.toBeInTheDocument();

    fireEvent.scroll(list, { target: { scrollTop: 999 * 56 } });
    expect(screen.getByText("原文标题 1000")).toBeInTheDocument();
    expect(screen.queryByText("原文标题 1")).not.toBeInTheDocument();
  });

  it("identifies current and last-read chapters with text and accessibility state", () => {
    setup();
    const current = screen.getByRole("button", { name: /原文标题 5.*현재 읽는 장/ });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveTextContent("현재 읽는 장");
    expect(screen.getByRole("button", { name: /原文标题 8.*마지막으로 읽은 장/ })).toHaveTextContent("마지막으로 읽은 장");
  });

  it("searches, sorts, and passes only the selected URL to navigation", () => {
    const { onNavigate } = setup({ catalog: makeCatalog(20) });
    fireEvent.change(screen.getByLabelText("장 번호 또는 제목 검색"), { target: { value: "原文标题 12" } });
    expect(screen.getByText("原文标题 12")).toBeInTheDocument();
    expect(screen.queryByText("原文标题 11")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /原文标题 12/ }));
    expect(onNavigate).toHaveBeenCalledWith("https://www.69shuba.com/txt/1/12");

    fireEvent.change(screen.getByLabelText("장 번호 또는 제목 검색"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "역순으로 정렬" }));
    expect(screen.getByText("原文标题 20")).toBeInTheDocument();
  });

  it("supports dialog focus, Escape, overlay close, and focus restoration", async () => {
    const { onClose, opener } = setup({ catalog: makeCatalog(20) });
    expect(screen.getByRole("dialog", { name: "작품 목차" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("장 번호 또는 제목 검색")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
