# Step 3: Reader presentation

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-06, FR-07, 성능·접근성·디자인 요구사항과 인수 조건 3부터 5
- `docs/ARCHITECTURE.md`의 3.1절, 8.1절, 10장, 13.2절
- `docs/UI_GUIDE.md` 전체
- `src/app/globals.css`
- `src/components/reader-prototype.tsx`
- `src/lib/reader/session.client.ts`
- `src/types/source.ts`
- `src/types/storage.ts`
- `src/types/translation.ts`

## 작업

Testing Library 테스트를 먼저 작성하고 `src/components/` 아래에 실제 reader session 상태를 렌더링하는 리더 컴포넌트를 구현하며 기준 프로토타입 스타일을 필요한 범위에서 분리·재사용한다.

- 작품명, 장 번호, 장 제목, 진행 상태, 보기 모드, 본문과 하단 장 이동 순서를 UI 가이드와 동일하게 유지한다.
- `페이지 불러오는 중`, `본문 분석 중`, `번역 중`, `완료`를 session state에서 파생하고 번역 중에는 완료 문단 수, 전체 문단 수, 백분율, progressbar와 취소 버튼을 제공한다.
- 완료된 번역 문단은 전체 완료 전에 즉시 표시하고 아직 번역되지 않은 문단에는 레이아웃 이동을 줄이는 자리 표시자를 둔다.
- `translation`, `original`, `both` 모드에서 문단 ID로 원문과 번역문을 대응시키며 함께 보기에서는 원문 다음에 번역문을 표시한다.
- 부분 실패 시 성공 문단을 유지하고 실패 위치와 재시도 동작을 색상 외의 문구와 형태로 표시한다.
- 사용자 reader settings의 16~24px 글자 크기와 행간을 본문에 적용하고 변경 callback을 제공한다.
- source와 translation 문자열은 React 텍스트 노드로만 렌더링하고 외부 이미지, HTML, style, iframe 또는 event handler를 생성하지 않는다.
- 360px에서 가로 스크롤 없이 동작하고 본문 기본 크기 16px 이상, 주요 터치 영역 44px, visible focus와 reduced motion을 보장한다.
- 기존 prototype에서 실제 리더가 대체한 하드코딩 데이터와 중복 UI만 제거한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/reader-view.test.tsx`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 각 session 상태가 정확한 사용자 문구와 접근 가능한 진행 정보 및 허용 동작을 표시하는지 확인한다.
2. 세 보기 모드가 동일 문단 ID의 원문과 번역문을 올바른 순서로 표시하는지 확인한다.
3. 번역 진행 중 완료 문단은 유지되고 미완료 문단만 placeholder이며 진행 이벤트 후 순차 교체되는지 확인한다.
4. 부분 실패가 성공 문단을 제거하지 않고 실패 범위 재시도 버튼을 제공하는지 확인한다.
5. 악의적인 HTML 형태의 원문이 markup으로 실행되지 않고 문자 그대로 표시되는지 확인한다.
6. 360px 스타일, 키보드 focus, 색상 외 상태 표현과 reduced motion 규칙을 확인한다.

## 금지사항

- `dangerouslySetInnerHTML`을 사용하지 마라. 이유: 원본 사이트 HTML이나 실행 가능한 콘텐츠를 클라이언트에 주입해서는 안 된다.
- 컴포넌트에서 source fetch, Gemini 요청 또는 IndexedDB를 직접 호출하지 마라. 이유: 네트워크와 저장 경계는 기존 서비스와 session controller를 통해야 한다.
- 보기 모드별로 서로 다른 문단 순서를 만들지 마라. 이유: 원문과 번역문의 ID 대응 관계를 유지해야 한다.
- UI 가이드의 금지된 blur, gradient text, glow, 장식 애니메이션 또는 과도한 card 중첩을 추가하지 마라. 이유: 장시간 독서 중심의 시각 방향을 훼손한다.
