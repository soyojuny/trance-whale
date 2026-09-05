# Step 2: EPUB import and reader navigation UI

## 읽어야 할 파일

- `AGENTS.md`
- `plan.md`의 단계 3
- `docs/PRD.md`의 FR-01, FR-01-1, FR-06, FR-07, FR-08과 인수 조건 1·5·7
- `docs/UI_GUIDE.md`의 5.2절, 6.1절, 6.2절, 6.4절, 6.5절, 8장, 11장, 13장
- `docs/VALIDATION.md`의 UI 회귀 방지 기준
- `src/components/home-settings-flow.tsx`, `src/components/reader/reader-navigation.client.tsx`, `src/components/catalog-sheet.tsx`, `src/app/read/page.tsx`, `src/app/globals.css`
- `src/lib/reader/session.client.ts`, `src/services/local-epub-library.client.ts`
- `tests/unit/home-settings-flow.test.tsx`, `tests/integration/reader-navigation.test.tsx`, `tests/unit/catalog-sheet.test.tsx`

## 작업

Step 1의 local library/session을 현재 UI에 연결한다. EPUB 전환에 명시된 입력·URL·reader navigation만 바꾸고, 기존의 시각 언어·설정 sheet·reader layout은 보존한다.

- 홈의 기본 CTA를 접근성 있는 `.epub` file picker로 바꾸고, 가까이에 로컬 저장·서버 미전송·콘텐츠 권리 안내를 둔다. file input `accept`는 보조이고 parser validation은 import service가 수행한다.
- 기존 URL form은 제거하지 말고 `웹 페이지 가져오기`라는 접을 수 있는 보조 영역으로 옮긴다. 기존 URL validation과 웹 reader flow를 보존한다.
- import 성공 시 `/read?book={bookId}&chapter={index}`로 이동한다. URL에 API Key, 파일명 또는 원문을 넣지 않는다. cancel, invalid EPUB, DRM/image based, quota 오류는 정의된 안전한 한국어 안내로 표시한다.
- reader navigation이 book/chapter URL을 열고 local previous/next와 local catalog를 제공하도록 연결한다. 목차가 없을 때는 spine previous/next만 제공한다. CatalogSheet의 검색·정렬·가상화·sheet focus/close 동작은 그대로 유지한다.
- Testing Library와 reader navigation integration test를 먼저 추가한다. 360px와 desktop에서 의도된 EPUB input/보조 URL section 외 UI 변화를 확인하고 `docs/VALIDATION.md`에 결과를 기록한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/home-settings-flow.test.tsx tests/integration/reader-navigation.test.tsx tests/unit/catalog-sheet.test.tsx
npm run typecheck
npm run lint
```

## 검증 절차

1. keyboard로 EPUB picker와 보조 URL disclosure를 작동시키고 cancel/오류 메시지가 안전하게 나타나는지 확인한다.
2. 성공 import가 `/read?book=...&chapter=0`로 이동하고 source API request가 없는지 확인한다.
3. local chapter의 이전·다음·목차 이동과 catalog 없는 spine navigation을 확인한다.
4. 360px와 desktop에서 horizontal overflow, 44px 미만 주요 target, 고정 reader toolbar, settings/catalog sheet의 회귀가 없는지 확인하고 문서에 결과를 남긴다.

## 금지사항

- EPUB 전환과 무관한 색상, typography, reader layout, 아이콘, settings sheet 또는 catalog interaction을 재설계하지 마라. 이유: 승인된 UI는 명시된 입력·탐색 변경 외 보존해야 한다.
- URL 보조 경로와 기존 HTTP validation을 제거하거나 EPUB과 합쳐 하나의 서버 submission으로 만들지 마라. 이유: 웹 수집은 유지되는 별도 경로다.
- file name, EPUB text 또는 API Key를 URL, UI error, test snapshot에 표시하지 마라. 이유: 개인정보·콘텐츠 노출 경계를 위반한다.
