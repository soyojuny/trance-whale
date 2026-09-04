# Step 6: Catalog source route

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-02, FR-06-1과 인수 조건
- `docs/ARCHITECTURE.md`의 7.2절, 7.3절, 8.3절, 14장, 15장
- `src/types/source.ts`
- `src/lib/errors.ts`
- `src/lib/source/fetch-source.server.ts`
- `src/lib/extractors/extractor.ts`
- `src/lib/extractors/shuba69.server.ts`

## 작업

통합 테스트를 먼저 작성하고 `src/app/api/source/catalog/route.ts`와 목차 수집 파이프라인을 구현한다.

- Node.js runtime을 명시하고 장 API와 동일한 안전한 요청·오류·`no-store` 규칙을 적용한다.
- 첫 목차 URL과 각 후속 페이지 URL에 URL/DNS 검증 및 제한 fetch를 반복한다.
- 중앙 상수로 정한 작은 최대 페이지 수를 강제하고 cycle을 감지한다.
- 병합한 결과를 `CatalogSource` 스키마로 검증한 뒤 반환한다.
- 전체 source pipeline 관련 테스트를 실행하고 문서 계약과 구현 차이가 생겼다면 관련 문서만 갱신한다.

## Acceptance Criteria

- `npm run test -- --run tests/integration/catalog-source-route.test.ts`
- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 검증 절차

1. 단일·다중 페이지 fixture가 하나의 순서 보존 목차 응답이 되는지 확인한다.
2. 각 redirect와 후속 목차 페이지가 재검증되는지 확인한다.
3. cycle, 최대 페이지 수, 중간 fetch 실패가 안전한 공개 오류가 되는지 확인한다.
4. 전체 테스트, 타입 검사, lint와 production build를 실행한다.

## 금지사항

- 목차 실패를 장 추출이나 장 탐색 링크 사용 불가로 연결하지 마라. 이유: PRD는 목차 실패 시에도 이전·다음 장 이동을 요구한다.
- 후속 페이지 URL을 검증 없이 fetch하지 마라. 이유: 추출된 외부 링크도 SSRF 입력이다.
- PWA, Gemini, IndexedDB 또는 리더 UI를 구현하지 마라. 이유: 이 phase는 source server pipeline만 다룬다.
