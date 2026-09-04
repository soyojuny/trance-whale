"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";

import { TRANSLATION_MODELS, type TranslationMode } from "../lib/translation/models";
import { MAX_USER_PROMPT_LENGTH } from "../lib/translation/prompt";
import { validateApiKey } from "../services/gemini.client";
import { createLocalDataService, type LocalDataResetResult } from "../services/local-data.client";
import { createPreferencesService, type Preferences, type StorageResult } from "../services/preferences.client";
import {
  DEFAULT_READER_SETTINGS,
  DEFAULT_TRANSLATION_SETTINGS,
  type LastReadingPosition,
} from "../types/storage";

type PreferencesPort = {
  loadPreferences(): Preferences;
  loadReadingPosition(): LastReadingPosition | null;
  savePreferences(preferences: Preferences): StorageResult;
  clearApiKey(): StorageResult;
};

type LocalDataPort = { clearAll(): Promise<LocalDataResetResult> };
type ValidateKey = typeof validateApiKey;

export type HomeSettingsFlowProps = {
  navigate?: (href: string) => void;
  preferences?: PreferencesPort;
  localData?: LocalDataPort;
  validateKey?: ValidateKey;
  onRetranslate?: () => void;
};

const supportedHost = "www.69shuba.com";

function defaultNavigate(href: string): void {
  globalThis.location.assign(href);
}

function readerHref(url: string): string {
  return `/read?url=${encodeURIComponent(url)}`;
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
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.hostname !== supportedHost) {
      setUrlError("현재 지원하지 않는 사이트입니다.");
      return;
    }
    setUrlError("");
    navigate(readerHref(parsed.toString()));
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
      <div className="page-wrap" inert={open ? true : undefined}>
        <header className="mobile-header"><strong>Trance Whale</strong></header>
        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">TRANCE WHALE</p>
          <h1 id="welcome-title">읽고 싶은 이야기를 가져오세요</h1>
          <p>외국어 웹소설 주소를 입력하면 자연스러운 한국어로 이어서 읽을 수 있어요.</p>
          <form className="url-form" onSubmit={submitUrl}>
            <label htmlFor="novel-url">웹소설 장 URL</label>
            <div className="url-control">
              <input id="novel-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="url-support url-error" />
              <button type="submit">번역해서 읽기</button>
            </div>
            <span id="url-support" className="support-note">현재 69shuba.com의 공개 페이지를 지원해요.</span>
            {urlError && <p id="url-error" role="alert">{urlError}</p>}
          </form>
          {lastPosition && (
            <button className="continue-card" type="button" aria-label="이어 읽기" onClick={() => navigate(readerHref(lastPosition.canonicalUrl))}>
              <span><small>이어 읽기</small><strong>마지막으로 읽던 장</strong></span>
              <span aria-hidden="true">→</span>
            </button>
          )}
          <button ref={openerRef} className="secondary-button" type="button" onClick={openSheet}>설정 열기</button>
        </section>
      </div>

      {open && (
        <div className="overlay" onMouseDown={dismissOverlay}>
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <header>
              <div><span>SETTINGS</span><h2 id="settings-title">읽기 및 번역 설정</h2></div>
              <button type="button" className="icon-button" onClick={closeSheet} aria-label="설정 닫기">닫기</button>
            </header>
            <div className="settings-body">
              <section>
                <label htmlFor="font-size">본문 글자 크기</label>
                <input ref={initialFocusRef} id="font-size" type="range" min="16" max="24" value={draft.reader.fontSize} onChange={(event) => setDraft({ ...draft, reader: { ...draft.reader, fontSize: Number(event.target.value) } })} />
                <output htmlFor="font-size">{draft.reader.fontSize}px</output>
              </section>
              <section>
                <label htmlFor="user-prompt">나만의 번역 지시</label>
                <textarea id="user-prompt" maxLength={MAX_USER_PROMPT_LENGTH} value={draft.translation.userPrompt} onChange={(event) => setDraft({ ...draft, translation: { ...draft.translation, userPrompt: event.target.value } })} placeholder="예: 인물 이름 표기와 말투를 일관되게 유지해 주세요." />
                <p>기본 번역 원칙은 항상 별도로 적용됩니다. {draft.translation.userPrompt.length} / {MAX_USER_PROMPT_LENGTH}자</p>
              </section>
              <section>
                <label htmlFor="translation-model">번역 모델</label>
                <select id="translation-model" value={draft.translation.translationMode} onChange={(event) => setDraft({ ...draft, translation: { ...draft.translation, translationMode: event.target.value as TranslationMode } })}>
                  {Object.values(TRANSLATION_MODELS).map((model) => <option key={model.mode} value={model.mode}>{model.label}{model.mode === "fast" ? " (추천)" : ""}</option>)}
                </select>
                {Object.values(TRANSLATION_MODELS).map((model) => <p key={model.mode}><strong>{model.label}:</strong> {model.speedDescription} {model.qualityDescription} {model.costDescription}</p>)}
              </section>
              <section>
                <label htmlFor="api-key">Gemini API Key</label>
                <div className="key-input-row">
                  <input id="api-key" type={revealKey ? "text" : "password"} autoComplete="off" value={draft.translation.apiKey} onChange={(event) => setDraft({ ...draft, translation: { ...draft.translation, apiKey: event.target.value } })} />
                  <button type="button" onClick={() => setRevealKey((value) => !value)}>{revealKey ? "API Key 숨기기" : "API Key 표시"}</button>
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
                <button type="button" onClick={save} disabled={!dirty || status === "saving"}>{status === "saving" ? "검증 및 저장 중" : "변경사항 저장"}</button>
                <button type="button" onClick={onRetranslate} disabled={dirty || status !== "saved" || !onRetranslate}>현재 장 다시 번역</button>
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
