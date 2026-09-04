# Step 4: Catalog sheet

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-02, FR-06-1, FR-08과 성능 요구사항 및 인수 조건 6, 7
- `docs/ARCHITECTURE.md`의 6.1절, 8.3절, 10장, 11장
- `docs/UI_GUIDE.md`의 5장, 6.5절, 8장, 9장, 11장
- `src/types/source.ts`
- `src/services/source-client.client.ts`
- `src/services/catalog-cache.client.ts`
- `src/components/reader-prototype.tsx`

## 작업

테스트를 먼저 작성하고 목차 조회 상태와 대규모 목록을 담당하는 `src/lib/catalog/session.client.ts` 및 `src/components/catalog-sheet.tsx`를 구현한다.

- catalog session은 정규화된 목차 URL로 Phase 3 cache를 먼저 조회하고 fresh hit이면 source client를 호출하지 않는다.
- stale 또는 miss이면 source client로 목차를 갱신하고 성공 결과를 cache에 저장하며, stale 갱신 실패 시 기존 stale 목록과 안전한 갱신 경고를 함께 유지한다.
- cache와 네트워크 출력은 기존 런타임 스키마를 통과한 `CatalogSource`만 상태에 넣고 취소와 늦은 응답 무시를 지원한다.
- 검색은 장 번호 문자열 또는 원문 제목을 대상으로 하고 정순·역순 정렬은 원본 `sourceIndex`를 기준으로 결정적으로 동작한다.
- sheet는 작품명, 전체 장 수, 검색, 정렬, 현재 읽는 장과 마지막 읽은 장 상태를 제공하고 선택한 URL만 navigation callback으로 전달한다.
- 2,000개 이상 장에서 viewport, scroll offset과 overscan으로 계산한 범위만 DOM에 렌더링하는 작은 고정 행 높이 가상 목록을 구현한다.
- 현재 장은 배경뿐 아니라 `현재 읽는 장` 문구와 접근성 상태로, 마지막 장은 별도 문구로 식별한다.
- 목차 제목은 원문 그대로 표시하고 번역 파이프라인에 전달하지 않는다.
- sheet의 dialog focus, `Escape`, 닫기 focus 복원, 모바일 bottom sheet와 데스크톱 right sheet 동작을 Step 2와 같은 규칙으로 제공한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/catalog-session.client.test.ts tests/unit/catalog-sheet.test.tsx`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. fresh cache hit에서 source client가 호출되지 않고 stale/miss에서만 갱신 요청이 발생하는지 확인한다.
2. stale 갱신 실패가 기존 목록을 보존하고 miss 실패는 장의 이전·다음 navigation 상태를 변경하지 않는지 확인한다.
3. 장 번호와 원문 제목 검색, 정순·역순 정렬이 `sourceIndex`와 원본 데이터를 변형하지 않는지 확인한다.
4. 2,000개 장 fixture에서 화면 주변 항목만 DOM에 존재하고 스크롤 후 올바른 장 범위가 표시되는지 확인한다.
5. 현재 장, 마지막 장과 선택 동작이 색상 외의 텍스트 및 접근성 상태로 구분되는지 확인한다.
6. 장 선택이 원본 사이트 이동이나 직접 fetch 없이 navigation callback만 호출하는지 확인한다.

## 금지사항

- 2,000개 장을 한 번에 DOM에 렌더링하지 마라. 이유: PRD의 대규모 목차 성능 요구를 충족해야 한다.
- 목차 장 제목을 번역하거나 Gemini로 보내지 마라. 이유: 목차 번역은 MVP 제외 사항이다.
- stale 갱신 실패 시 사용 가능한 기존 목록을 버리지 마라. 이유: 네트워크 장애에도 저장된 독서 탐색을 유지해야 한다.
- 장 선택에서 원본 URL로 브라우저를 직접 이동시키지 마라. 이유: 모든 장 이동은 앱 내부 리더 흐름을 거쳐야 한다.
- 범용 상태 또는 가상화 라이브러리를 이 기능만을 위해 추가하지 마라. 이유: 고정 높이 목록의 요구 범위는 작은 순수 계산으로 충분하다.
