"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import CatalogSheet from "../catalog-sheet";
import { createCatalogSession, type CatalogSession, type CatalogSessionState } from "../../lib/catalog/session.client";
import { createReaderSessionController, type ReaderSessionController, type ReaderSessionState } from "../../lib/reader/session.client";
import { prepareCachedChapterTranslation } from "../../lib/translation/cached-pipeline.client";
import { createCatalogCache } from "../../services/catalog-cache.client";
import { createPreferencesService, type Preferences, type StorageResult } from "../../services/preferences.client";
import { openReaderDatabase } from "../../services/reader-db.client";
import { createSourceCache } from "../../services/source-cache.client";
import { createSourceClient } from "../../services/source-client.client";
import { createTranslationCache } from "../../services/translation-cache.client";
import type { LastReadingPosition } from "../../types/storage";
import ReaderView from "./reader-view";
import Icon from "../ui/icon";
import { TRANSLATION_MODELS, type TranslationMode } from "../../lib/translation/models";
import { MAX_USER_PROMPT_LENGTH } from "../../lib/translation/prompt";

const SCROLL_THROTTLE_MS = 150;

type PreferencesPort = {
  loadPreferences(): Preferences;
  savePreferences(preferences: Preferences): StorageResult;
  loadReadingPosition(): LastReadingPosition | null;
  saveReadingPosition(position: LastReadingPosition): StorageResult;
};

export type ReaderNavigationRuntime = {
  readerSession: ReaderSessionController;
  catalogSession: CatalogSession;
  preferences: PreferencesPort;
  subscribeReader(listener: (state: ReaderSessionState) => void): void;
  subscribeCatalog(listener: (state: CatalogSessionState) => void): void;
  close(): void;
};

export type ReaderNavigationProps = {
  initialUrl: string;
  navigate?: (href: string) => void;
  runtime?: ReaderNavigationRuntime;
};

function readerHref(url: string): string {
  return `/read?url=${encodeURIComponent(url)}`;
}

async function createDefaultRuntime(): Promise<ReaderNavigationRuntime> {
  let readerListener: (state: ReaderSessionState) => void = () => undefined;
  let catalogListener: (state: CatalogSessionState) => void = () => undefined;
  const database = await openReaderDatabase();
  const sourceClient = createSourceClient();
  const preferences = createPreferencesService(window.localStorage);
  const translationCache = createTranslationCache({ database });
  const sourceCache = createSourceCache({ database });
  const readerSession = createReaderSessionController({
    sourceClient,
    sourceCache,
    networkAvailable: () => navigator.onLine,
    loadTranslationSettings: () => preferences.loadPreferences().translation,
    preparePipeline: (request) => prepareCachedChapterTranslation(request, { cache: translationCache }),
    onStateChange: (state) => readerListener(state),
  });
  const catalogSession = createCatalogSession({
    sourceClient,
    cache: createCatalogCache({ database }),
    onStateChange: (state) => catalogListener(state),
  });
  return {
    readerSession,
    catalogSession,
    preferences,
    subscribeReader(listener) { readerListener = listener; },
    subscribeCatalog(listener) { catalogListener = listener; },
    close() {
      readerSession.cancel();
      catalogSession.cancel();
      database.close();
    },
  };
}

export default function ReaderNavigation({ initialUrl, navigate, runtime: suppliedRuntime }: ReaderNavigationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedUrl = initialUrl || searchParams.get("url") || "";
  const push = navigate ?? ((href: string) => router.push(href));
  const [runtime, setRuntime] = useState<ReaderNavigationRuntime | null>(suppliedRuntime ?? null);
  const [readerState, setReaderState] = useState<ReaderSessionState>({ status: "idle" });
  const [catalogState, setCatalogState] = useState<CatalogSessionState>({ status: "idle" });
  const [settings, setSettings] = useState(() => suppliedRuntime?.preferences.loadPreferences().reader);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [translationDraft, setTranslationDraft] = useState(() => suppliedRuntime?.preferences.loadPreferences().translation ?? {
    apiKey: "",
    translationMode: "fast" as TranslationMode,
    userPrompt: "",
  });
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [readerRevealKey, setReaderRevealKey] = useState(false);
  const desktopCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const catalogReturnFocusRef = useRef<HTMLElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const activeCanonicalRef = useRef<string | undefined>(undefined);
  const latestScrollRef = useRef(0);
  const lastOpenedUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (suppliedRuntime) {
      setRuntime(suppliedRuntime);
      return;
    }
    let active = true;
    let created: ReaderNavigationRuntime | undefined;
    void createDefaultRuntime().then((value) => {
      created = value;
      if (active) setRuntime(value);
      else value.close();
    });
    return () => {
      active = false;
      created?.close();
    };
  }, [suppliedRuntime]);

  useEffect(() => {
    if (!runtime) return;
    runtime.subscribeReader(setReaderState);
    runtime.subscribeCatalog(setCatalogState);
    setSettings(runtime.preferences.loadPreferences().reader);
    setTranslationDraft(runtime.preferences.loadPreferences().translation);
  }, [runtime]);

  const savePosition = useCallback((service: ReaderNavigationRuntime | null, canonicalUrl: string | undefined, scrollPosition: number) => {
    if (!service || !canonicalUrl) return;
    service.preferences.saveReadingPosition({
      canonicalUrl,
      scrollPosition: Math.max(0, Math.round(scrollPosition)),
      updatedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    if (!runtime || !requestedUrl || lastOpenedUrlRef.current === requestedUrl) return;
    if (lastOpenedUrlRef.current) {
      savePosition(runtime, activeCanonicalRef.current, window.scrollY);
      runtime.readerSession.cancel();
      activeCanonicalRef.current = undefined;
      latestScrollRef.current = 0;
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    lastOpenedUrlRef.current = requestedUrl;
    void runtime.readerSession.openChapter(requestedUrl);
  }, [requestedUrl, runtime, savePosition]);

  const canonicalUrl = "chapter" in readerState ? readerState.chapter.canonicalUrl : undefined;
  useEffect(() => {
    if (!runtime || !canonicalUrl || canonicalUrl === activeCanonicalRef.current) return;
    activeCanonicalRef.current = canonicalUrl;
    const saved = runtime.preferences.loadReadingPosition();
    const top = saved?.canonicalUrl === canonicalUrl ? saved.scrollPosition : 0;
    latestScrollRef.current = top;
    window.scrollTo({ top, behavior: "auto" });
  }, [canonicalUrl, runtime]);

  useEffect(() => {
    if (!runtime || !canonicalUrl) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      latestScrollRef.current = window.scrollY;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (activeCanonicalRef.current === canonicalUrl) {
          savePosition(runtime, canonicalUrl, latestScrollRef.current);
        }
      }, SCROLL_THROTTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      if (activeCanonicalRef.current === canonicalUrl) {
        savePosition(runtime, canonicalUrl, window.scrollY);
      }
    };
  }, [canonicalUrl, runtime, savePosition]);

  useEffect(() => () => runtime?.close(), [runtime]);

  useEffect(() => {
    if (!settingsOpen) return;
    setReaderRevealKey(false);
    settingsCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        requestAnimationFrame(() => settingsButtonRef.current?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  const navigateChapter = (url: string) => push(readerHref(url));
  const openCatalog = (url: string, trigger = desktopCatalogButtonRef.current) => {
    if (!runtime) return;
    catalogReturnFocusRef.current = trigger;
    setCatalogOpen(true);
    void runtime.catalogSession.open(url);
  };
  const chapter = "chapter" in readerState ? readerState.chapter : undefined;

  if (!runtime || !settings) return <main className="reader-empty-state" role="status">리더 준비 중</main>;

  return (
    <main className="app-shell reader-page">
      <aside className="side-rail" aria-label="주 탐색">
        <button type="button" className="brand-mark" onClick={() => push("/")} aria-label="Trance Whale 홈"><span>TW</span></button>
        <nav>
          <button type="button" className="rail-link" onClick={() => push("/")}><Icon name="home" /><span>홈</span></button>
          <button type="button" className="rail-link" onClick={() => chapter?.navigation.catalog && openCatalog(chapter.navigation.catalog.url)}><Icon name="list" /><span>목차</span></button>
          <button ref={settingsButtonRef} type="button" className="rail-link" onClick={() => setSettingsOpen(true)}><Icon name="settings" /><span>설정</span></button>
        </nav>
      </aside>
      <div className="reader-session-actions">
        <button type="button" aria-label="현재 장 다시 불러오기" onClick={() => void runtime.readerSession.forceReload()}>↻</button>
      </div>
      <ReaderView
        state={readerState}
        settings={settings}
        onCancel={runtime.readerSession.cancel}
        onRetryFailed={() => void runtime.readerSession.retryFailedTranslation()}
        onSettingsChange={(reader) => {
          setSettings(reader);
          const preferences = runtime.preferences.loadPreferences();
          runtime.preferences.savePreferences({ ...preferences, reader });
        }}
        onNavigateChapter={navigateChapter}
        onOpenCatalog={openCatalog}
        catalogButtonRef={desktopCatalogButtonRef}
      />
      {chapter && (
        <nav className="mobile-reader-tools is-visible" aria-label="모바일 독서 도구">
          <button type="button" disabled={!chapter.navigation.previous} aria-label={chapter.navigation.previous ? `이전 장: ${chapter.navigation.previous.label ?? "장 이동"}` : "이전 장 없음"} onClick={() => chapter.navigation.previous && navigateChapter(chapter.navigation.previous.url)}>←<small>이전 장</small></button>
          <button ref={mobileCatalogButtonRef} type="button" disabled={!chapter.navigation.catalog} aria-label={chapter.navigation.catalog ? "목차 열기 (모바일)" : "목차 없음"} onClick={() => chapter.navigation.catalog && openCatalog(chapter.navigation.catalog.url, mobileCatalogButtonRef.current)}><Icon name="list" /><small>목차</small></button>
          <button type="button" aria-label="홈으로 이동" onClick={() => push("/")}><Icon name="home" /><small>홈</small></button>
          <button type="button" disabled={!chapter.navigation.next} aria-label={chapter.navigation.next ? `다음 장: ${chapter.navigation.next.label ?? "장 이동"}` : "다음 장 없음"} onClick={() => chapter.navigation.next && navigateChapter(chapter.navigation.next.url)}>→<small>다음 장</small></button>
        </nav>
      )}
      {catalogOpen && catalogState.status === "ready" && (
        <CatalogSheet
          catalog={catalogState.catalog}
          currentChapterUrl={chapter?.canonicalUrl}
          lastReadChapterUrl={runtime.preferences.loadReadingPosition()?.canonicalUrl}
          warning={catalogState.warning}
          onNavigate={(url) => { setCatalogOpen(false); navigateChapter(url); }}
          onClose={() => setCatalogOpen(false)}
          returnFocusRef={catalogReturnFocusRef}
        />
      )}
      {catalogOpen && catalogState.status === "error" && <p role="alert">{catalogState.message}</p>}
      {settingsOpen && (
        <div className="overlay" onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
          if (event.target === event.currentTarget) {
            setSettingsOpen(false);
            requestAnimationFrame(() => settingsButtonRef.current?.focus());
          }
        }}>
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="reader-settings-title">
            <header>
              <div><span>SETTINGS</span><h2 id="reader-settings-title">읽기 및 번역 설정</h2></div>
              <button ref={settingsCloseRef} type="button" className="icon-button" aria-label="설정 닫기" onClick={() => {
                setSettingsOpen(false);
                requestAnimationFrame(() => settingsButtonRef.current?.focus());
              }}><Icon name="x" /></button>
            </header>
            <div className="settings-body">
              <section>
                <div className="setting-title"><strong>본문 글자 크기</strong><span>{settings.fontSize}px</span></div>
                <input type="range" min="16" max="24" value={settings.fontSize} onChange={(event) => setSettings({ ...settings, fontSize: Number(event.target.value) })} />
              </section>
              <section className="prompt-setting">
                <label htmlFor="reader-user-prompt">나만의 번역 지시</label>
                <textarea id="reader-user-prompt" maxLength={MAX_USER_PROMPT_LENGTH} value={translationDraft.userPrompt} onChange={(event) => { setSettingsSaved(false); setTranslationDraft({ ...translationDraft, userPrompt: event.target.value }); }} placeholder="예: 인물 이름 표기와 말투를 일관되게 유지해 주세요." />
                <p>기본 번역 원칙은 항상 별도로 적용됩니다. {translationDraft.userPrompt.length} / {MAX_USER_PROMPT_LENGTH}자</p>
              </section>
              <section>
                <label htmlFor="reader-translation-model">번역 모델</label>
                <select className="visually-hidden" id="reader-translation-model" aria-label="번역 모델" value={translationDraft.translationMode} onChange={(event) => { setSettingsSaved(false); setTranslationDraft({ ...translationDraft, translationMode: event.target.value as TranslationMode }); }}>
                  {Object.values(TRANSLATION_MODELS).map((model) => <option key={model.mode} value={model.mode}>{model.label}{model.mode === "fast" ? " (추천)" : ""}</option>)}
                </select>
                {Object.values(TRANSLATION_MODELS).map((model) => <label key={model.mode} className={`radio-card ${translationDraft.translationMode === model.mode ? "selected" : ""}`}>
                  <input type="radio" name="reader-translation-model-card" checked={translationDraft.translationMode === model.mode} onChange={() => { setSettingsSaved(false); setTranslationDraft({ ...translationDraft, translationMode: model.mode }); }} />
                  <span><strong>{model.label}</strong><small>{model.mode === "fast" ? "속도와 대량 번역 우선" : "문체와 맥락 우선"}</small></span>
                  {model.mode === "fast" && <b>추천</b>}
                </label>)}
              </section>
              <section>
                <label htmlFor="reader-api-key">Gemini API Key</label>
                <div className="key-field"><input id="reader-api-key" type={readerRevealKey ? "text" : "password"} autoComplete="off" value={translationDraft.apiKey} onChange={(event) => { setSettingsSaved(false); setTranslationDraft({ ...translationDraft, apiKey: event.target.value }); }} /><button type="button" onClick={() => setReaderRevealKey((value) => !value)} aria-label={`API Key ${readerRevealKey ? "숨기기" : "표시"}`}>{readerRevealKey ? "숨기기" : "표시"}</button></div>
                <p>Key는 브라우저에만 저장되고 앱 서버로 전송되지 않습니다.</p>
              </section>
              {settingsSaved && <p role="status">저장됨 · 다음 장부터 적용</p>}
              <button type="button" className="save-button" onClick={() => { const current = runtime.preferences.loadPreferences(); runtime.preferences.savePreferences({ ...current, reader: settings, translation: translationDraft }); setSettingsSaved(true); }}>변경사항 저장</button>
              <button className="retranslate-button" type="button" aria-label="현재 장 다시 번역" onClick={() => {
                setSettingsOpen(false);
                void runtime.readerSession.forceRetranslate();
                requestAnimationFrame(() => settingsButtonRef.current?.focus());
              }}>현재 장 다시 번역</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
