# Step 3: EPUB end-to-end validation

## 읽어야 할 파일

- `AGENTS.md`
- `plan.md`의 단계 4와 완료·중단 기준
- `docs/PRD.md`의 FR-01, FR-06부터 FR-09, 10장, 인수 조건 1~15
- `docs/ARCHITECTURE.md`의 PWA, offline, service worker와 보안 경계 관련 절
- `docs/UI_GUIDE.md`의 5.2절, 6장, 11장, 13장
- `docs/VALIDATION.md`의 EPUB 추가 필요 항목과 UI 회귀 방지 기준
- `playwright.config.ts`, `tests/e2e/mvp-reader.spec.ts`
- `src/services/local-epub-library.client.ts`, `src/lib/reader/session.client.ts`, `src/app/sw.ts`

## 작업

합성 EPUB만으로 새 EPUB 핵심 흐름을 종단 간 검증하고, 구현과 문서의 검증 근거를 일치시킨다.

- Playwright에서 합성 2장 EPUB을 선택해 첫 장 번역, next, catalog 이동, reload cache reuse와 offline re-open을 검증한다. 실제 원본 사이트·실제 Gemini API·사용자 EPUB은 절대 사용하지 않는다.
- API/Gemini/source route interception과 IndexedDB/Service Worker 검사를 통해 EPUB archive가 library storage에만 남고 `/api/`, Gemini API 요청 및 API Key 포함 요청이 Service Worker cache에 들어가지 않는지 검증한다.
- unit/integration gaps가 있으면 최소한의 추가 test로 보강하고 `docs/VALIDATION.md`의 EPUB 자동 근거와 360px/desktop 결과를 실제 검증 결과로 갱신한다. 이미 정확한 PRD/ARCHITECTURE 범위를 불필요하게 다시 작성하지 않는다.
- browser runtime이 없거나 fixture file selection을 지원하지 않는 환경은 test skip, loose assertion, timeout 증가로 숨기지 말고 정확한 blocked reason을 남긴다.

## Acceptance Criteria

```bash
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
git diff --check
```

## 검증 절차

1. 2장 EPUB의 title, spine, catalog, raw HTML 미렌더링, local internal navigation을 확인한다.
2. reload와 offline에서 source/Gemini network request 없이 저장된 chapter와 translation cache가 복원되는지 확인한다.
3. service worker cache와 IndexedDB assertions에 API Key, filename, source/translation text가 남지 않는지 확인한다.
4. 360px와 desktop에서 EPUB CTA·보조 URL disclosure·reader/navigation/sheet가 의도대로이고 그 밖의 시각·상호작용 차이가 없는지 확인한다.

## 금지사항

- 실제 EPUB, 원문 사이트, Gemini API 또는 API Key를 automated test·snapshot·artefact에 사용하지 마라. 이유: 저작권·비밀값·외부 상태 경계를 위반한다.
- `/api/`, Gemini 또는 EPUB archive를 Service Worker cache에 추가하지 마라. 이유: PWA cache는 app shell과 static asset으로 제한된다.
- browser 부족을 skip, 완화된 assertion, 임의 timeout으로 통과처럼 보이게 하지 마라. 이유: 검증 근거가 아니라 환경 차단을 정확히 기록해야 한다.
