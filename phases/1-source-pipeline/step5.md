# Step 5: 69shuba catalog extractor

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-02와 FR-06-1
- `docs/ARCHITECTURE.md`의 3.3절, 6.1절, 8.3절
- `src/types/source.ts`
- `src/lib/extractors/extractor.ts`
- `src/lib/extractors/shuba69.server.ts`

## 작업

fixture 계약 테스트를 먼저 작성하고 기존 69shuba 어댑터의 목차 추출 및 제한된 병합 동작을 완성한다.

- `tests/fixtures/69shuba/`에 단일 및 다중 페이지 목차 fixture를 둔다.
- 작품명, 안정적인 장 ID, 절대 URL, 원문 제목, 가능한 장 번호와 `sourceIndex`를 추출한다.
- 중복 장은 정규화 URL 기준으로 제거하되 원본 순서를 유지한다.
- 사이트별 다음 목차 페이지 탐색 정보는 어댑터 내부에 둔다.
- 여러 페이지 결과를 최대 페이지 수 안에서 하나의 `CatalogSource`로 병합하는 순수하거나 주입 가능한 로직을 구현한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/shuba69-catalog-extractor.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 단일 페이지의 작품명, 장 제목, URL, 번호와 원본 순서를 확인한다.
2. 여러 페이지 병합 시 순서 유지와 중복 제거를 확인한다.
3. 페이지 순환과 최대 페이지 수가 무한 요청 없이 종료되는지 확인한다.
4. script, style, 광고 텍스트나 HTML이 결과에 없는지 확인한다.

## 금지사항

- 목차 제목을 번역하지 마라. 이유: 목차 번역은 MVP 제외 사항이다.
- 전체 장 목록을 서버나 전역 메모리에 캐시하지 마라. 이유: 서버 공유 캐시는 MVP 범위가 아니다.
- 사이트 pagination selector를 공통 fetch 모듈에 넣지 마라. 이유: 사이트별 DOM 규칙은 어댑터에만 있어야 한다.
