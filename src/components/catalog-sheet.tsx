"use client";

import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";

import {
  filterAndSortCatalogChapters,
  type CatalogSortOrder,
} from "../lib/catalog/session.client";
import { CatalogSourceSchema, type CatalogSource } from "../types/source";

const ROW_HEIGHT = 56;
const VIEWPORT_HEIGHT = 560;
const OVERSCAN = 4;

type CatalogSheetProps = {
  catalog: CatalogSource;
  currentChapterUrl?: string;
  lastReadChapterUrl?: string;
  warning?: string;
  onNavigate: (url: string) => void;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

function chapterStatus(current: boolean, lastRead: boolean): string {
  if (current && lastRead) return "현재 읽는 장 · 마지막으로 읽은 장";
  if (current) return "현재 읽는 장";
  if (lastRead) return "마지막으로 읽은 장";
  return "";
}

export default function CatalogSheet({
  catalog: catalogInput,
  currentChapterUrl,
  lastReadChapterUrl,
  warning,
  onNavigate,
  onClose,
  returnFocusRef,
}: CatalogSheetProps) {
  const catalog = CatalogSourceSchema.parse(catalogInput);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<CatalogSortOrder>("ascending");
  const [scrollTop, setScrollTop] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const chapters = useMemo(
    () => filterAndSortCatalogChapters(catalog.chapters, query, order),
    [catalog.chapters, order, query],
  );
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(chapters.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visibleChapters = chapters.slice(start, end);

  const close = useCallback((): void => {
    onClose();
    requestAnimationFrame(() => returnFocusRef?.current?.focus());
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    searchRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [close]);

  function dismissOverlay(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) close();
  }

  return (
    <div className="overlay" onMouseDown={dismissOverlay}>
      <section ref={dialogRef} className="sheet catalog-sheet" role="dialog" aria-modal="true" aria-labelledby="catalog-title">
        <header>
          <div><span>{catalog.bookTitle}</span><h2 id="catalog-title">작품 목차</h2></div>
          <button type="button" className="icon-button" onClick={close} aria-label="목차 닫기">닫기</button>
        </header>
        <div className="catalog-body">
          {warning && <p className="catalog-warning" role="status">{warning}</p>}
          <div className="catalog-tools">
            <label>
              <span className="visually-hidden">장 번호 또는 제목 검색</span>
              <input
                ref={searchRef}
                aria-label="장 번호 또는 제목 검색"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setScrollTop(0); }}
                placeholder="장 번호 또는 제목 검색"
              />
            </label>
            <button
              type="button"
              aria-label={order === "ascending" ? "역순으로 정렬" : "정순으로 정렬"}
              onClick={() => { setOrder((value) => value === "ascending" ? "descending" : "ascending"); setScrollTop(0); }}
            >
              {order === "ascending" ? "정순 ↑" : "역순 ↓"}
            </button>
          </div>
          <p className="catalog-count">전체 {catalog.chapters.length}화 · 검색 결과 {chapters.length}화</p>
          <ol
            className="catalog-virtual-list"
            aria-label="장 목록"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            style={{ height: VIEWPORT_HEIGHT, position: "relative", overflowY: "auto" }}
          >
            <li aria-hidden="true" className="catalog-list-spacer" style={{ height: chapters.length * ROW_HEIGHT }} />
            {visibleChapters.map((chapter, visibleIndex) => {
              const index = start + visibleIndex;
              const current = chapter.url === currentChapterUrl;
              const lastRead = chapter.url === lastReadChapterUrl;
              const status = chapterStatus(current, lastRead);
              return (
                <li key={chapter.id} className={current ? "current" : ""} style={{ position: "absolute", top: index * ROW_HEIGHT, right: 0, left: 0, height: ROW_HEIGHT }}>
                  <button type="button" aria-current={current ? "page" : undefined} onClick={() => onNavigate(chapter.url)}>
                    <span>{chapter.number ?? "—"}</span>
                    <strong>{chapter.title}</strong>
                    {status && <small>{status}</small>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
