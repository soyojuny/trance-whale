"use client";

import { useEffect, useRef, useState } from "react";

type IconName = "book" | "home" | "list" | "settings" | "arrow" | "spark" | "x" | "search" | "check" | "sliders" | "eye" | "eyeOff";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"/></>,
    home: <><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></>,
    list: <><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    spark: <path d="m12 3 1.4 4.2L18 9l-4.6 1.8L12 15l-1.4-4.2L6 9l4.6-1.8L12 3ZM5 16l.7 2.3L8 19l-2.3.7L5 22l-.7-2.3L2 19l2.3-.7L5 16Z"/>,
    x: <path d="m6 6 12 12M18 6 6 18"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    sliders: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
    eyeOff: <><path d="m3 3 18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a14 14 0 0 1-2.1 2.8M6.2 6.2C3.8 7.7 2.5 12 2.5 12s3.5 6 9.5 6a9 9 0 0 0 3.3-.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const translated = [
  "날이 저물자 먼 산들이 엷은 안개 속으로 가라앉았다.",
  "진우는 낡은 돌계단 끝에 서서 한참 동안 아무 말도 하지 않았다. 계곡 아래로 흐르는 물소리만이 고요한 산문을 채웠다.",
  "그가 이곳을 떠난 지도 벌써 십 년이었다. 하지만 처마 끝에 매달린 청동 방울도, 바람에 섞인 솔향도 기억 속 모습과 조금도 다르지 않았다.",
  "“돌아오셨군요.”",
  "등 뒤에서 들려온 목소리에 그는 천천히 몸을 돌렸다. 흰옷을 입은 소녀가 등불을 들고 서 있었다.",
];

const originals = [
  "天色渐暗，远处的群山沉入薄雾。",
  "陈宇站在古老石阶的尽头，久久没有说话。只有山谷下的流水声，填满了寂静的山门。",
  "他离开这里已经十年了。可檐角的铜铃，风中的松香，都和记忆中没有半点不同。",
  "“你回来了。”",
  "听到身后的声音，他缓缓转身。一个白衣少女提着灯，站在那里。",
];

export default function ReaderPrototype() {
  const [mode, setMode] = useState<"translation" | "original" | "both">("translation");
  const [panel, setPanel] = useState<"catalog" | "settings" | null>(null);
  const [fontSize, setFontSize] = useState(19);
  const [savedPrompt, setSavedPrompt] = useState("인물 이름은 한자 독음으로 표기하고, 무협 용어의 분위기를 살려주세요.");
  const [promptDraft, setPromptDraft] = useState(savedPrompt);
  const [savedModel, setSavedModel] = useState<"fast" | "quality">("fast");
  const [modelDraft, setModelDraft] = useState<"fast" | "quality">("fast");
  const [savedApiKey, setSavedApiKey] = useState("demo-key-for-ui-preview");
  const [apiKeyDraft, setApiKeyDraft] = useState(savedApiKey);
  const [readerToolsVisible, setReaderToolsVisible] = useState(false);
  const readerSectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!("IntersectionObserver" in window)) {
      setReaderToolsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => setReaderToolsVisible(entry.isIntersecting), { threshold: 0.05 });
    if (readerSectionRef.current) observer.observe(readerSectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <main className="app-shell">
      <aside className="side-rail" aria-label="주 탐색">
        <a className="brand-mark" href="#top" aria-label="Trance Whale 홈"><span>TW</span></a>
        <nav>
          <a className="rail-link is-active" href="#top"><Icon name="home"/><span>홈</span></a>
          <button className="rail-link" onClick={() => setPanel("catalog")}><Icon name="list"/><span>목차</span></button>
          <button className="rail-link" onClick={() => setPanel("settings")}><Icon name="settings"/><span>설정</span></button>
        </nav>
        <span className="rail-version">Beta 0.1</span>
      </aside>

      <div className="page-wrap" id="top">
        <header className="mobile-header">
          <a className="mobile-brand" href="#top"><span className="brand-mark small">TW</span><strong>Trance Whale</strong></a>
          <button className="icon-button" onClick={() => setPanel("settings")} aria-label="설정 열기"><Icon name="settings"/></button>
        </header>

        <section className="welcome" aria-labelledby="welcome-title">
          <div className="eyebrow"><Icon name="spark" size={16}/> YOUR QUIET READING SPACE</div>
          <h1 id="welcome-title">읽고 싶은 이야기를<br/>가져오세요</h1>
          <p>외국어 웹소설의 주소를 붙여넣으면, 흐름을 잃지 않는 자연스러운 한국어로 읽을 수 있어요.</p>
          <form className="url-form" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="novel-url">웹소설 장 URL</label>
            <div className="url-control">
              <span className="url-symbol">↗</span>
              <input id="novel-url" type="url" defaultValue="https://www.69shuba.com/txt/48273/32028706"/>
              <button type="submit">번역해서 읽기 <Icon name="arrow" size={18}/></button>
            </div>
            <span className="support-note"><Icon name="check" size={15}/> 현재 69shuba.com의 공개 페이지를 지원해요</span>
          </form>
          <button className="continue-card" type="button">
            <span className="book-tile"><Icon name="book" size={23}/></span>
            <span className="continue-copy"><small>이어 읽기</small><strong>검선독존 · 제128화 산문으로 돌아오다</strong><span>어제 읽음 · 73%</span></span>
            <span className="continue-progress"><i style={{ width: "73%" }}/></span>
            <Icon name="arrow" size={19}/>
          </button>
        </section>

        <section className="reader-section" aria-labelledby="chapter-title" ref={readerSectionRef}>
          <div className="reader-topbar">
            <div className="chapter-meta"><span>검선독존</span><span className="dot">·</span><span>제128화</span></div>
            <div className="reader-actions">
              <button onClick={() => setPanel("catalog")} aria-label="목차 열기"><Icon name="list" size={18}/> 목차</button>
              <button onClick={() => setPanel("settings")}><Icon name="sliders" size={18}/> 읽기 설정</button>
            </div>
          </div>

          <div className="reader-column">
            <div className="reader-heading">
              <p>CHAPTER 128</p>
              <h2 id="chapter-title">산문으로 돌아오다</h2>
              <span>回到山门</span>
            </div>

            <div className="translation-status" role="status">
              <span className="status-icon"><Icon name="spark" size={17}/></span>
              <div><strong>이 장을 번역하고 있어요</strong><span>38 / 52 문단</span></div>
              <div className="progress-track"><i style={{ width: "73%" }}/></div>
              <b>73%</b>
              <button>취소</button>
            </div>

            <div className="mode-row" aria-label="본문 보기 방식">
              <div className="segmented-control">
                <button className={mode === "translation" ? "selected" : ""} onClick={() => setMode("translation")}>번역문</button>
                <button className={mode === "original" ? "selected" : ""} onClick={() => setMode("original")}>원문</button>
                <button className={mode === "both" ? "selected" : ""} onClick={() => setMode("both")}>함께 보기</button>
              </div>
              <span className="saved-state"><Icon name="check" size={15}/> 기기에 저장됨</span>
            </div>

            <article className={`reading-copy mode-${mode}`} style={{ fontSize }}>
              {translated.map((paragraph, index) => (
                <div className="paragraph-pair" key={paragraph}>
                  {mode !== "translation" && <p className="original-copy" lang="zh">{originals[index]}</p>}
                  {mode !== "original" && <p>{paragraph}</p>}
                </div>
              ))}
              <div className="loading-lines" aria-label="다음 문단 번역 중"><span/><span/><span/></div>
            </article>

            <nav className="chapter-nav" aria-label="장 이동">
              <button className="nav-direction previous"><span className="nav-arrow">←</span><span className="nav-copy"><small>이전 장</small><strong>제127화 오랜 약속</strong></span></button>
              <button onClick={() => setPanel("catalog")} className="catalog-shortcut"><Icon name="list"/><span>목차</span></button>
              <button className="nav-direction next"><span className="nav-copy"><small>다음 장</small><strong>제129화 손님</strong></span><span className="nav-arrow">→</span></button>
            </nav>
          </div>
        </section>

        <footer><span className="footer-whale">〰</span><strong>Trance Whale</strong><span>당신의 키와 번역은 이 기기에만 머물러요.</span></footer>
      </div>

      <nav className={`mobile-reader-tools ${readerToolsVisible ? "is-visible" : ""}`} aria-label="모바일 독서 도구">
        <button><span className="reverse-arrow"><Icon name="arrow" size={18}/></span><small>이전 장</small></button>
        <button onClick={() => setPanel("catalog")}><Icon name="list" size={18}/><small>목차</small></button>
        <button onClick={() => setPanel("settings")}><Icon name="sliders" size={18}/><small>읽기 설정</small></button>
        <button><Icon name="arrow" size={18}/><small>다음 장</small></button>
      </nav>

      {panel && <div className="overlay" onMouseDown={() => setPanel(null)}>
        <section className="sheet" role="dialog" aria-modal="true" aria-label={panel === "catalog" ? "작품 목차" : "읽기 및 번역 설정"} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>{panel === "catalog" ? "검선독존" : "내 읽기 환경"}</span><h2>{panel === "catalog" ? "작품 목차" : "설정"}</h2></div><button className="icon-button" onClick={() => setPanel(null)} aria-label="닫기"><Icon name="x"/></button></header>
          {panel === "catalog" ? <Catalog/> : <Settings fontSize={fontSize} setFontSize={setFontSize} savedPrompt={savedPrompt} promptDraft={promptDraft} setPromptDraft={setPromptDraft} savedModel={savedModel} modelDraft={modelDraft} setModelDraft={setModelDraft} savedApiKey={savedApiKey} apiKeyDraft={apiKeyDraft} setApiKeyDraft={setApiKeyDraft} onSaveSettings={() => { setSavedPrompt(promptDraft); setSavedModel(modelDraft); setSavedApiKey(apiKeyDraft); }} onRetranslate={() => setPanel(null)}/>} 
        </section>
      </div>}
    </main>
  );
}

function Catalog() {
  const chapters = ["제124화 달빛 아래에서", "제125화 오래된 편지", "제126화 떠날 채비", "제127화 오랜 약속", "제128화 산문으로 돌아오다", "제129화 손님", "제130화 새벽의 검"];
  return <div className="catalog-body">
    <div className="catalog-tools"><label><Icon name="search" size={18}/><input placeholder="장 번호 또는 제목 검색"/></label><button>최신순 ↓</button></div>
    <p className="catalog-count">전체 842화 · 마지막으로 읽은 위치</p>
    <ol>{chapters.map((chapter, index) => <li className={index === 4 ? "current" : ""} key={chapter}><button><span>{String(124 + index).padStart(3, "0")}</span><strong>{chapter}</strong>{index === 4 && <small>읽는 중 · 73%</small>}<i>→</i></button></li>)}</ol>
  </div>;
}

type SettingsProps = {
  fontSize: number;
  setFontSize: (value: number) => void;
  savedPrompt: string;
  promptDraft: string;
  setPromptDraft: (value: string) => void;
  savedModel: "fast" | "quality";
  modelDraft: "fast" | "quality";
  setModelDraft: (value: "fast" | "quality") => void;
  savedApiKey: string;
  apiKeyDraft: string;
  setApiKeyDraft: (value: string) => void;
  onSaveSettings: () => void;
  onRetranslate: () => void;
};

function Settings({ fontSize, setFontSize, savedPrompt, promptDraft, setPromptDraft, savedModel, modelDraft, setModelDraft, savedApiKey, apiKeyDraft, setApiKeyDraft, onSaveSettings, onRetranslate }: SettingsProps) {
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const hasUnsavedSettings = promptDraft !== savedPrompt || modelDraft !== savedModel || apiKeyDraft !== savedApiKey;
  const savedModelLabel = savedModel === "fast" ? "빠른 번역" : "고품질 번역";

  return <div className="settings-body">
    <section><div className="setting-title"><strong>글자 크기</strong><span>{fontSize}px</span></div><input aria-label="본문 글자 크기" type="range" min="16" max="24" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}/><div className="range-labels"><span>가</span><span>가</span></div></section>
    <section className="prompt-setting">
      <div className="setting-title"><strong>나만의 번역 지시</strong><span>{promptDraft.length} / 500</span></div>
      <p className="prompt-intro">작품의 이름 표기, 말투, 문체처럼 번역에 반영할 내용을 적어주세요.</p>
      <label htmlFor="translation-prompt">사용자 번역 프롬프트</label>
      <textarea id="translation-prompt" maxLength={500} value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} placeholder="예: 주인공은 반말을 사용하고 기술명은 한자로 병기해주세요."/>
      <div className="base-prompt-note"><Icon name="check" size={15}/><span><strong>기본 번역 원칙은 항상 함께 적용돼요.</strong><small>문단 구조, 문체, 고유명사 일관성을 유지합니다.</small></span></div>
    </section>
    <section><div className="setting-title"><strong>번역 모델</strong><span>저장 후 다음 번역부터 적용</span></div><label className={`radio-card ${modelDraft === "fast" ? "selected" : ""}`}><input type="radio" name="model" checked={modelDraft === "fast"} onChange={() => setModelDraft("fast")}/><span><strong>빠른 번역</strong><small>속도와 무료 할당량 우선</small></span><b>추천</b></label><label className={`radio-card ${modelDraft === "quality" ? "selected" : ""}`}><input type="radio" name="model" checked={modelDraft === "quality"} onChange={() => setModelDraft("quality")}/><span><strong>고품질 번역</strong><small>문체와 맥락의 섬세함 우선</small></span></label></section>
    <section><div className="setting-title"><strong>Gemini API Key</strong><span className="safe">● 기기에만 저장</span></div><div className="key-field"><input aria-label="Gemini API Key" type={isKeyVisible ? "text" : "password"} value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} placeholder="Google AI Studio API Key 입력" autoComplete="off" spellCheck={false}/><button type="button" onClick={() => setIsKeyVisible((visible) => !visible)} aria-label={`API Key ${isKeyVisible ? "숨기기" : "표시"}`}><Icon name={isKeyVisible ? "eyeOff" : "eye"} size={17}/><span>{isKeyVisible ? "숨기기" : "표시"}</span></button></div><p>키는 Trance Whale 서버로 전송되지 않아요. 브라우저 저장소는 완전한 보안 저장소가 아닙니다.</p></section>
    <div className="settings-actions">
      <div className={`prompt-save-state ${hasUnsavedSettings ? "unsaved" : ""}`}><span aria-hidden="true">{hasUnsavedSettings ? "●" : "✓"}</span>{hasUnsavedSettings ? "저장되지 않은 변경" : "저장됨 · 다음 장부터 적용"}</div>
      {!hasUnsavedSettings && <p className="saved-summary">{savedModelLabel} 설정이 저장됐어요.</p>}
      <button className="save-button" onClick={onSaveSettings} disabled={!hasUnsavedSettings}>변경사항 저장</button>
      <button className="retranslate-button" disabled={hasUnsavedSettings} onClick={onRetranslate}>현재 장 다시 번역 <Icon name="arrow" size={16}/></button>
      {hasUnsavedSettings && <p className="save-first-note">현재 장에 적용하려면 변경사항을 먼저 저장해 주세요.</p>}
    </div>
  </div>;
}
