"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import CatalogSheet from "../catalog-sheet";
import { createCatalogSession, type CatalogSession, type CatalogSessionState } from "../../lib/catalog/session.client";
import { createReaderSessionController, type ReaderSessionController, type ReaderSessionState } from "../../lib/reader/session.client";
import { prepareCachedChapterTranslation } from "../../lib/translation/cached-pipeline.client";
import { createCatalogCache } from "../../services/catalog-cache.client";
import { createPreferencesService, type Preferences, type StorageResult } from "../../services/preferences.client";
import { openReaderDatabase } from "../../services/reader-db.client";
import { createSourceClient } from "../../services/source-client.client";
import { createTranslationCache } from "../../services/translation-cache.client";
import type { LastReadingPosition } from "../../types/storage";
import ReaderView from "./reader-view";

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
  const readerSession = createReaderSessionController({
    sourceClient,
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
  const push = navigate ?? ((href: string) => router.push(href));
  const [runtime, setRuntime] = useState<ReaderNavigationRuntime | null>(suppliedRuntime ?? null);
  const [readerState, setReaderState] = useState<ReaderSessionState>({ status: "idle" });
  const [catalogState, setCatalogState] = useState<CatalogSessionState>({ status: "idle" });
  const [settings, setSettings] = useState(() => suppliedRuntime?.preferences.loadPreferences().reader);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const desktopCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const catalogReturnFocusRef = useRef<HTMLElement>(null);
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
    if (!runtime || !initialUrl || lastOpenedUrlRef.current === initialUrl) return;
    if (lastOpenedUrlRef.current) {
      savePosition(runtime, activeCanonicalRef.current, window.scrollY);
      runtime.readerSession.cancel();
      activeCanonicalRef.current = undefined;
      latestScrollRef.current = 0;
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    lastOpenedUrlRef.current = initialUrl;
    void runtime.readerSession.openChapter(initialUrl);
  }, [initialUrl, runtime, savePosition]);

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
      <button type="button" className="reader-home-button" onClick={() => push("/")} aria-label="홈으로 이동">홈</button>
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
          <button ref={mobileCatalogButtonRef} type="button" disabled={!chapter.navigation.catalog} aria-label={chapter.navigation.catalog ? "목차 열기 (모바일)" : "목차 없음"} onClick={() => chapter.navigation.catalog && openCatalog(chapter.navigation.catalog.url, mobileCatalogButtonRef.current)}>☷<small>목차</small></button>
          <button type="button" aria-label="홈으로 이동 (모바일)" onClick={() => push("/")}>⌂<small>홈</small></button>
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
    </main>
  );
}
