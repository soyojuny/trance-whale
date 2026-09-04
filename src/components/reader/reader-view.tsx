"use client";

import type { RefObject } from "react";

import type { ReaderSessionState } from "../../lib/reader/session.client";
import type { NavigationTarget } from "../../types/source";
import type { ReaderSettings, ViewMode } from "../../types/storage";

type ReaderViewProps = {
  state: ReaderSessionState;
  settings: ReaderSettings;
  onCancel?: () => void;
  onRetryFailed?: () => void;
  onSettingsChange?: (settings: ReaderSettings) => void;
  onNavigateChapter?: (url: string) => void;
  onOpenCatalog?: (url: string) => void;
  catalogButtonRef?: RefObject<HTMLButtonElement | null>;
};

const MODE_LABELS: Array<{ mode: ViewMode; label: string }> = [
  { mode: "translation", label: "번역문" },
  { mode: "original", label: "원문" },
  { mode: "both", label: "함께 보기" },
];

function statusLabel(status: ReaderSessionState["status"]): string {
  if (status === "fetching_source") return "페이지 불러오는 중";
  if (status === "parsing_response" || status === "checking_cache") return "본문 분석 중";
  if (status === "translating") return "번역 중";
  if (status === "complete") return "완료";
  if (status === "partial_failure") return "일부 번역 실패";
  if (status === "cancelled") return "번역 취소됨";
  if (status === "failed") return "불러오지 못함";
  return "읽을 장을 선택해 주세요";
}

function NavigationButton({
  direction,
  target,
  onNavigate,
}: {
  direction: "previous" | "next";
  target?: NavigationTarget;
  onNavigate?: (url: string) => void;
}) {
  const label = direction === "previous" ? "이전 장" : "다음 장";
  return (
    <button
      type="button"
      className={`nav-direction ${direction}`}
      disabled={!target}
      aria-label={target ? `${label}: ${target.label ?? "장 이동"}` : `${label} 없음`}
      onClick={() => target && onNavigate?.(target.url)}
    >
      {direction === "previous" && <span className="nav-arrow">←</span>}
      <span className="nav-copy"><small>{label}</small><strong>{target?.label ?? `${label}이 없습니다`}</strong></span>
      {direction === "next" && <span className="nav-arrow">→</span>}
    </button>
  );
}

export default function ReaderView({
  state,
  settings,
  onCancel,
  onRetryFailed,
  onSettingsChange,
  onNavigateChapter,
  onOpenCatalog,
  catalogButtonRef,
}: ReaderViewProps) {
  if (!("chapter" in state)) {
    return <section className="reader-empty-state" role="status">{state.status === "failed" ? state.error.message : statusLabel(state.status)}</section>;
  }

  const { chapter } = state;
  const translations = new Map(state.translations.map((paragraph) => [paragraph.id, paragraph.text]));
  const percentage = state.totalParagraphs === 0 ? 0 : Math.round((state.completedParagraphs / state.totalParagraphs) * 100);
  const isTranslating = state.status === "translating";
  const isPartialFailure = state.status === "partial_failure";
  const isRetryingFailedChunks = isTranslating && state.retryingFailedChunks;
  const fontSize = Math.min(24, Math.max(16, settings.fontSize));

  return (
    <section className="reader-section" aria-labelledby="chapter-title">
      <div className="reader-topbar">
        <div className="chapter-meta">
          {chapter.bookTitle && <span>{chapter.bookTitle}</span>}
          {chapter.bookTitle && chapter.chapterNumber && <span className="dot">·</span>}
          {chapter.chapterNumber && <span>제{chapter.chapterNumber}화</span>}
        </div>
        <div className="reader-actions">
          <button ref={catalogButtonRef} type="button" disabled={!chapter.navigation.catalog} onClick={() => chapter.navigation.catalog && onOpenCatalog?.(chapter.navigation.catalog.url)}>목차</button>
          <label>본문 글자 크기 <input type="range" min="16" max="24" value={fontSize} onChange={(event) => onSettingsChange?.({ ...settings, fontSize: Number(event.target.value) })} /></label>
          <label>본문 줄 간격 <input type="range" min="1.5" max="2.5" step="0.1" value={settings.lineHeight} onChange={(event) => onSettingsChange?.({ ...settings, lineHeight: Number(event.target.value) })} /></label>
        </div>
      </div>

      <div className="reader-column">
        <header className="reader-heading">
          {chapter.chapterNumber && <p>CHAPTER {chapter.chapterNumber}</p>}
          <h2 id="chapter-title">{chapter.chapterTitle}</h2>
        </header>

        <div className={`translation-status${isPartialFailure ? " is-error" : ""}`} role="status">
          <span className="status-icon" aria-hidden="true">{state.status === "complete" ? "✓" : isPartialFailure ? "!" : "…"}</span>
          <div><strong>{statusLabel(state.status)}</strong><span>{state.completedParagraphs} / {state.totalParagraphs} 문단</span></div>
          <div className="progress-track" role="progressbar" aria-label="번역 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><i style={{ width: `${percentage}%` }} /></div>
          <b>{percentage}%</b>
          {isTranslating && <button type="button" aria-label="번역 취소" onClick={onCancel}>취소</button>}
        </div>

        {isPartialFailure && (
          <div className="translation-failure" role="alert">
            <span>번역하지 못한 문단이 {state.totalParagraphs - state.completedParagraphs}개 있습니다.</span>
            {state.errors.map((error) => <p key={error.code}>{error.message}</p>)}
            {state.errors.some((error) => error.retryable)
              ? <button type="button" aria-label="실패한 문단 다시 번역" onClick={onRetryFailed}>다시 번역</button>
              : <span>다시 번역할 수 없는 실패가 있습니다.</span>}
          </div>
        )}

        {isRetryingFailedChunks && (
          <div className="translation-failure" role="status">
            <span>실패한 문단을 다시 번역하는 중입니다.</span>
            {state.retryingErrors?.map((error) => <p key={error.code}>{error.message}</p>)}
          </div>
        )}

        <div className="mode-row" aria-label="본문 보기 방식">
          <div className="segmented-control">
            {MODE_LABELS.map(({ mode, label }) => <button key={mode} type="button" className={settings.viewMode === mode ? "selected" : ""} aria-pressed={settings.viewMode === mode} onClick={() => onSettingsChange?.({ ...settings, viewMode: mode })}>{label}</button>)}
          </div>
        </div>

        <article className={`reading-copy mode-${settings.viewMode}`} style={{ fontSize: `${fontSize}px`, lineHeight: String(settings.lineHeight) }}>
          {chapter.paragraphs.map((paragraph) => {
            const translation = translations.get(paragraph.id);
            return (
              <div className="paragraph-pair" data-testid={`paragraph-${paragraph.id}`} key={paragraph.id}>
                {settings.viewMode !== "translation" && <p className="original-copy">{paragraph.text}</p>}
                {settings.viewMode !== "original" && (translation
                  ? <p>{translation}</p>
                  : isPartialFailure || isRetryingFailedChunks
                    ? <p className="failed-paragraph"><strong>번역 실패</strong><span>이 문단을 다시 번역할 수 있습니다.</span></p>
                    : <span className="paragraph-placeholder" aria-label={`${paragraph.id} 번역 대기 중`}><i /><i /><i /></span>)}
              </div>
            );
          })}
        </article>

        <nav className="chapter-nav" aria-label="장 이동">
          <NavigationButton direction="previous" target={chapter.navigation.previous} onNavigate={onNavigateChapter} />
          <button type="button" className="catalog-shortcut" disabled={!chapter.navigation.catalog} aria-label="목차 열기" onClick={() => chapter.navigation.catalog && onOpenCatalog?.(chapter.navigation.catalog.url)}>☷<span>목차</span></button>
          <NavigationButton direction="next" target={chapter.navigation.next} onNavigate={onNavigateChapter} />
        </nav>
      </div>
    </section>
  );
}
