# Step 5: Local data reset

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-05, FR-08, FR-09와 인수 조건 11
- `docs/ARCHITECTURE.md`의 11장부터 13장, 15장
- `src/services/preferences.client.ts`
- `src/services/reader-db.client.ts`
- `src/services/translation-cache.client.ts`
- `src/services/catalog-cache.client.ts`
- `src/lib/errors.ts`

## 작업

통합 테스트를 먼저 작성하고 `src/services/local-data.client.ts`에 Trance Whale의 브라우저 저장 데이터를 한 번에 삭제하는 유스케이스를 구현한다.

- 파일에 `client-only` 경계를 적용하고 preferences, IndexedDB factory와 Cache Storage 호환 객체를 주입받을 수 있게 한다.
- Step 1의 앱 소유 localStorage 키, Step 2의 Reader DB와 앱 소유 Cache Storage만 삭제한다.
- 앱 소유 Cache Storage는 Phase 4 Service Worker가 사용할 명시적인 prefix로 식별하고 다른 cache 이름은 보존한다.
- 각 저장 영역의 삭제를 시도하고 성공 여부를 영역별로 반환하여 일부 실패가 다른 영역의 삭제를 막지 않게 한다.
- 삭제 결과와 오류에는 API Key, 사용자 프롬프트, 본문, 번역문, URL 또는 원본 브라우저 예외 메시지를 포함하지 않는다.
- 반복 호출이 이미 비어 있는 저장소에서도 성공하는 멱등성을 보장한다.

## Acceptance Criteria

- `npm run test -- --run tests/integration/local-data-reset.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 설정, 마지막 위치, 번역 캐시, 목차 캐시와 앱 소유 Cache Storage가 한 번의 호출로 제거되는지 확인한다.
2. 무관한 localStorage 키와 다른 Cache Storage 이름은 보존되는지 확인한다.
3. 한 저장 영역의 삭제 실패 후에도 나머지 영역 삭제를 계속하고 영역별 안전한 결과를 반환하는지 확인한다.
4. 삭제를 반복해도 실패하지 않고 삭제 결과에 저장된 콘텐츠나 비밀값이 나타나지 않는지 확인한다.

## 금지사항

- `localStorage.clear()`나 모든 Cache Storage 삭제를 사용하지 마라. 이유: 앱이 소유하지 않은 origin 데이터를 지울 수 있다.
- 삭제 전에 API Key나 저장 콘텐츠를 읽어 결과에 포함하지 마라. 이유: 전체 삭제 과정에서 비밀값과 사용자 콘텐츠가 노출될 필요가 없다.
- 하나의 삭제 실패에서 즉시 중단하지 마라. 이유: 가능한 저장 영역은 계속 정리하고 사용자에게 부분 실패를 알려야 한다.
- 삭제 확인 dialog나 설정 UI를 구현하지 마라. 이유: 이 step은 UI가 호출할 삭제 유스케이스만 제공한다.
- Service Worker를 등록하지 마라. 이유: PWA 런타임은 Phase 4의 책임이다.
