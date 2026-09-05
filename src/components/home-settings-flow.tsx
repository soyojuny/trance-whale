"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";

import { TRANSLATION_MODELS, type TranslationMode } from "../lib/translation/models";
import { MAX_USER_PROMPT_LENGTH } from "../lib/translation/prompt";
import { toPublicError, type PublicError } from "../lib/errors";
import { parseEpub } from "../lib/epub/parse-epub.client";
import { parseLocalEpubLocator } from "../lib/epub/locator.client";
import { validateApiKey } from "../services/gemini.client";
import { createCatalogCache } from "../services/catalog-cache.client";
import { createLocalDataService, type LocalDataResetResult } from "../services/local-data.client";
import { createLocalEpubLibrary } from "../services/local-epub-library.client";
import { createPreferencesService, type Preferences, type StorageResult } from "../services/preferences.client";
import { openReaderDatabase } from "../services/reader-db.client";
import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_TRANSLATION_SETTINGS,
  type LastReadingPosition,
} from "../types/storage";
import Icon from "./ui/icon";

type PreferencesPort = {
  loadPreferences(): Preferences;
  loadReadingPosition(): LastReadingPosition | null;
  savePreferences(preferences: Preferences): StorageResult;
  clearApiKey(): StorageResult;
};

type LocalDataPort = { clearAll(): Promise<LocalDataResetResult> };
type ValidateKey = typeof validateApiKey;
type EpubImportResult =
  | { ok: true; book: { id: string } }
  | { ok: false; error: PublicError };
type ImportEpub = (file: File) => Promise<EpubImportResult>;

export type HomeSettingsFlowProps = {
  navigate?: (href: string) => void;
  preferences?: PreferencesPort;
  localData?: LocalDataPort;
  validateKey?: ValidateKey;
  importEpub?: ImportEpub;
  onRetranslate?: () => void;
};

function defaultNavigate(href: string): void {
  globalThis.location.assign(href);
}

function readerHref(url: string): string {
  const local = parseLocalEpubLocator(url);
  if (local) return `/read?book=${local.bookId}&chapter=${local.chapterIndex}`;
  return `/read?url=${encodeURIComponent(url)}`;
}

export async function importLocalEpub(file: File): Promise<EpubImportResult> {
  let database: Awaited<ReturnType<typeof openReaderDatabase>> | undefined;
  try {
    const parsed = await parseEpub(file);
    database = await openReaderDatabase();
    const library = createLocalEpubLibrary({
      database,
      catalogCache: createCatalogCache({ database }),
    });
    return await library.import({ archive: file, ...parsed });
  } catch (error) {
    return { ok: false, error: toPublicError(error) };
  } finally {
    database?.close();
  }
}

function resetFailureSummary(result: LocalDataResetResult): string | null {
  const areas: Array<[string, LocalDataResetResult[keyof LocalDataResetResult]]> = [
    ["설정", result.preferences],
    ["읽기 데이터", result.readerDatabase],
    ["앱 캐시", result.cacheStorage],
  ];
  const failed = areas.filter((entry) => !entry[1].ok).map((entry) => entry[0]);
  return failed.length > 0 ? `${failed.join(", ")} 삭제에 실패했습니다. 다시 시도해 주세요.` : null;
}

export default function HomeSettingsFlow({
  navigate = defaultNavigate,
  preferences,
  localData,
  validateKey = validateApiKey,
  importEpub = importLocalEpub,
  onRetranslate,
}: HomeSettingsFlowProps) {
  const services = useMemo(() => {
    const preferenceService = preferences ?? (typeof window === "undefined" ? null : createPreferencesService(window.localStorage));
    return {
      preferences: preferenceService,
      localData: localData ?? (typeof window === "undefined" ? null : createLocalDataService()),
    };
  }, [localData, preferences]);
  const initial = useMemo(() => services.preferences?.loadPreferences() ?? {
    translation: { ...DEFAULT_TRANSLATION_SETTINGS },
    reader: { ...DEFAULT_READER_SETTINGS },
  }, [services]);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [lastPosition, setLastPosition] = useState(() => services.preferences?.loadReadingPosition() ?? null);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [webImportOpen, setWebImportOpen] = useState(false);
  const [epubStatus, setEpubStatus] = useState("");
  const [epubError, setEpubError] = useState("");
  const [open, setOpen] = useState(false);
  const [revealKey, setRevealKey] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [message, setMessage] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmKeyDeletion, setConfirmKeyDeletion] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (preferences || !services.preferences) return;
    const loaded = services.preferences.loadPreferences();
    setSaved(loaded);
    setDraft(loaded);
    setLastPosition(services.preferences.loadReadingPosition());
  }, [preferences, services]);

  function closeSheet(): void {
    setOpen(false);
    setRevealKey(false);
    setConfirmReset(false);
    setConfirmKeyDeletion(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  function openSheet(): void {
    setRevealKey(false);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    initialFocusRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSheet();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function submitUrl(event: FormEvent): void {
    event.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setUrlError("올바른 URL을 입력해 주세요.");
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      setUrlError("올바른 URL을 입력해 주세요.");
      return;
    }
    setUrlError("");
    navigate(readerHref(parsed.toString()));
  }

  async function selectEpub(file: File | undefined): Promise<void> {
    setEpubError("");
    if (!file) {
      setEpubStatus("파일 선택을 취소했습니다.");
      return;
    }
    setEpubStatus("EPUB 가져오는 중");
    const result = await importEpub(file);
    if (!result.ok) {
      setEpubStatus("");
      setEpubError(result.error.message);
      return;
    }
    navigate(`/read?book=${result.book.id}&chapter=0`);
  }

  async function save(): Promise<void> {
    setStatus("saving");
    setMessage("");
    if (draft.translation.apiKey !== saved.translation.apiKey) {
      try {
        await validateKey({
          apiKey: draft.translation.apiKey,
          modelId: TRANSLATION_MODELS[draft.translation.translationMode].modelId,
          signal: new AbortController().signal,
        });
      } catch {
        setStatus("idle");
        setMessage("Gemini API Key를 확인해 주세요.");
        return;
      }
    }
    const result = services.preferences?.savePreferences(draft);
    if (!result) {
      setStatus("idle");
      setMessage("설정을 저장할 수 없습니다.");
      return;
    }
    if (!result.ok) {
      setStatus("idle");
      setMessage(result.error.message);
      return;
    }
    setSaved(draft);
    setStatus("saved");
    setMessage("");
  }

  async function clearAll(): Promise<void> {
    if (!services.localData || !services.preferences) {
      setMessage("저장된 데이터를 삭제할 수 없습니다.");
      return;
    }
    const result = await services.localData.clearAll();
    setConfirmReset(false);
    const failure = resetFailureSummary(result);
    if (failure) {
      setMessage(failure);
      return;
    }
    const cleared = services.preferences.loadPreferences();
    setSaved(cleared);
    setDraft(cleared);
    setLastPosition(null);
    setStatus("idle");
    setMessage("저장된 데이터를 모두 삭제했습니다.");
  }

  function clearApiKey(): void {
    const preferenceService = services.preferences;
    if (!preferenceService) {
      setMessage("Gemini API Key를 삭제할 수 없습니다.");
      return;
    }
    const result = preferenceService.clearApiKey();
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }

    const cleared = preferenceService.loadPreferences();
    setSaved(cleared);
    setDraft(cleared);
    setConfirmKeyDeletion(false);
    setRevealKey(false);
    setStatus("idle");
    setMessage("API Key를 삭제했습니다.");
  }

  function dismissOverlay(event: MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) closeSheet();
  }

  return (
    <main className="app-shell">
      <aside className="side-rail" aria-label="주 탐색">
        <a className="brand-mark" href="#top" aria-label="Trance Whale 홈"><span>TW</span></a>
        <nav>
          <a className="rail-link is-active" href="#top"><Icon name="home" /><span>홈</span></a>
          <button className="rail-link" type="button" onClick={openSheet}><Icon name="settings" /><span>설정</span></button>
        </nav>
        <span className="rail-version">Beta 0.1</span>
      </aside>
      <div className="page-wrap" inert={open ? true : undefined}>
        <header className="mobile-header"><strong>Trance Whale</strong><button ref={openerRef} className="icon-button" type="button" onClick={openSheet} aria-label="설정 열기"><Icon name="settings" /></button></header>
        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">TRANCE WHALE</p>
          <h1 id="welcome-title">읽고 싶은 이야기를 가져오세요</h1>
          <p>합법적으로 이용할 수 있는 EPUB을 선택해 이 기기에서 번역하며 읽을 수 있어요.</p>
          <section className="epub-import" aria-labelledby="epub-import-title">
            <h2 id="epub-import-title">EPUB 파일 가져오기</h2>
            <label className="epub-picker" htmlFor="epub-file">EPUB 파일 선택</label>
            <input id="epub-file" className="visually-hidden" type="file" accept=".epub,application/epub+zip" onChange={(event) => void selectEpub(event.currentTarget.files?.[0])} />
            <p className="support-note"><Icon name="check" size={15} />파일은 이 기기에만 저장되며 앱 서버로 전송되지 않습니다. 콘텐츠 이용 권한을 확인해 주세요.</p>
            {epubStatus && <p role="status">{epubStatus}</p>}
            {epubError && <p role="alert">{epubError}</p>}
          </section>
          <section className="web-import" aria-label="웹 페이지 가져오기">
            <button type="button" className="web-import-toggle" aria-expanded={webImportOpen} onClick={() => setWebImportOpen((open) => !open)}>웹 페이지 가져오기</button>
            {webImportOpen && <form className="url-form" onSubmit={submitUrl}>
              <label htmlFor="novel-url">웹소설 장 URL</label>
              <div className="url-control">
                <span className="url-symbol"><Icon name="arrow" size={17} /></span>
                <input id="novel-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="url-support url-error" />
                <button type="submit">번역해서 읽기</button>
              </div>
              <span id="url-support" className="support-note"><Icon name="check" size={15} />현재 69shuba.com의 공개 페이지를 지원해요.</span>
              {urlError && <p id="url-error" role="alert">{urlError}</p>}
            </form>}
          </section>
          {lastPosition && (
            <button className="continue-card" type="button" aria-label="이어 읽기" onClick={() => navigate(readerHref(lastPosition.canonicalUrl))}>
              <span className="book-tile" aria-hidden="true"><Icon name="book" size={23} /></span>
              <span className="continue-copy"><small>이어 읽기</small><strong>마지막으로 읽던 장</strong><span>저장된 위치에서 계속</span></span>
              <Icon name="arrow" size={19} aria-hidden="true" />
            </button>
          )}
        </section>
      </div>

      {open && (
        <div className="overlay" onMouseDown={dismissOverlay}>
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header>
              <div><span>SETTINGS</span><h2 id="settings-title">읽기 및 번역 설정</h2></div>
              <button type="button" className="icon-button" onClick={closeSheet} aria-label="설정 닫기"><Icon name="x" /></button>
            </header>
            <div className="settings-body">
              <section>
                <div className="setting-title"><strong>글자 크기</strong><span>{draft.reader.fontSize}px</span></div>
                <label className="visually-hidden" htmlFor="font-size">본문 글자 크기</label>
                <input ref={initialFocusRef} id="font-size" type="range" min="16" max="24" value={draft.reader.fontSize} onChange={(event) => setDraft({ ...draft, reader: { ...draft.reader, fontSize: Number(event.target.value) } })} />
                <div className="range-labels" aria-hidden="true"><span>가</span><span>가</span></div>
              </section>
              <section className="prompt-setting">
                <div className="setting-title"><strong>나만의 번역 지시</strong><span>{draft.translation.userPrompt.length} / {MAX_USER_PROMPT_LENGTH}</span></div>
                <p className="prompt-intro">작품의 이름 표기, 말투, 문체처럼 번역에 반영할 내용을 적어주세요.</p>
                <label htmlFor="user-prompt">나만의 번역 지시</label>
                <textarea id="user-prompt" maxLength={MAX_USER_PROMPT_LENGTH} value={draft.translation.userPrompt} onChange={(event) => setDraft({ ...draft, translation: { ...draft.translation, userPrompt: event.target.value } })} placeholder="예: 인물 이름 표기와 말투를 일관되게 유지해 주세요." />
                <div className="base-prompt-note"><Icon name="check" size={15} /><span><strong>기본 번역 원칙은 항상 함께 적용돼요.</strong><small>문단 구조, 문체, 고유명사 일관성을 유지합니다.</small></span></div>
              </section>
              <section>
                <div className="setting-title"><strong>번역 모델</strong><span>저장 후 다음 번역부터 적용</span></div>
                <select className="visually-hidden" aria-label="번역 모델" value={draft.translation.translationMode} onChange={(event) => setDraft({ ...draft, translation: { ...draft.translation, translationMode: event.target.value as TranslationMode } })}>
                  {Object.values(TRANSLATION_MODELS).map((model) => <option key={model.mode} value={model.mode}>{model.label}{model.mode === "fast" ? " (추천)" : ""}</option>)}
                </select>
                {Object.values(TRANSLATION_MODELS).map((model) => <label key={model.mode} className={`radio-card ${draft.translation.translationMode === model.mode ? "selected" : ""}`}>
                  <input type="radio" name="translation-model-card" value={model.mode} checked={draft.translation.translationMode === model.mode} onChange={() => setDraft({ ...draft, translation: { ...draft.translation, translationMode: model.mode } })} />
                  <span><strong>{model.label}</strong><small>{model.mode === "fast" ? "속도와 대량 번역 우선" : "문체와 맥락 우선"}</small></span>
                  {model.mode === "fast" && <b>추천</b>}
                </label>)}
              </section>
              <section>
                <div className="setting-title"><strong>Gemini API Key</strong><span className="safe">● 기기에만 저장</span></div>
                <label className="visually-hidden" htmlFor="api-key">Gemini API Key</label>
                <div className="key-field">
                  <input id="api-key" type={revealKey ? "text" : "password"} autoComplete="off" value={draft.translation.apiKey} onChange={(event) => setDraft({ ...draft, translation: { ...draft.translation, apiKey: event.target.value } })} />
                  <button type="button" onClick={() => setRevealKey((value) => !value)} aria-label={`API Key ${revealKey ? "숨기기" : "표시"}`}><Icon name={revealKey ? "eyeOff" : "eye"} size={17} /><span>{revealKey ? "숨기기" : "표시"}</span></button>
                </div>
                {saved.translation.apiKey && (
                  !confirmKeyDeletion ? (
                    <button className="destructive-button" type="button" onClick={() => setConfirmKeyDeletion(true)} disabled={dirty}>API Key 삭제</button>
                  ) : (
                    <div role="group" aria-label="API Key 삭제 확인">
                      <p>저장된 Gemini API Key를 삭제할까요?</p>
                      <button type="button" onClick={() => setConfirmKeyDeletion(false)}>취소</button>
                      <button className="destructive-button" type="button" onClick={clearApiKey}>API Key 삭제 확인</button>
                    </div>
                  )
                )}
                <p>Key는 브라우저에만 저장되고 앱 서버로 전송되지 않습니다. 브라우저 저장소는 완전한 보안 저장소가 아닙니다.</p>
                <p>입력 본문은 Gemini 데이터 처리 정책을 따르며 무료 등급 데이터가 제품 개선에 사용될 수 있습니다. 외부 콘텐츠의 저작권과 이용약관 준수 책임은 사용자에게 있습니다.</p>
              </section>
              <div className="settings-actions">
                <p aria-live="polite">{dirty ? "저장되지 않은 변경" : status === "saved" ? "저장됨 · 다음 장부터 적용" : "저장된 설정"}</p>
                {message && <p role={message.includes("삭제했습니다") ? "status" : "alert"}>{message}</p>}
                <button className="save-button" type="button" onClick={save} disabled={!dirty || status === "saving"}>{status === "saving" ? "검증 및 저장 중" : "변경사항 저장"}</button>
                <button className="retranslate-button" type="button" onClick={onRetranslate} disabled={dirty || status !== "saved" || !onRetranslate}>현재 장 다시 번역 <Icon name="arrow" size={16} /></button>
                {!confirmReset ? (
                  <button type="button" onClick={() => setConfirmReset(true)}>전체 데이터 삭제</button>
                ) : (
                  <div role="group" aria-label="전체 데이터 삭제 확인">
                    <p>앱에 저장된 설정, 읽기 데이터와 앱 캐시를 삭제할까요?</p>
                    <button type="button" onClick={() => setConfirmReset(false)}>취소</button>
                    <button type="button" onClick={clearAll}>삭제 확인</button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
