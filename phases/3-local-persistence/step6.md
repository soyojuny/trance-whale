# Step 6: Cached translation pipeline

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-07, FR-08과 인수 조건 3, 4, 8, 9, 14
- `docs/ARCHITECTURE.md`의 6.2절, 8.1절, 9장부터 11장, 14장, 15장
- `src/types/source.ts`
- `src/types/storage.ts`
- `src/types/translation.ts`
- `src/lib/translation/pipeline.client.ts`
- `src/lib/translation/cache-key.client.ts`
- `src/services/translation-cache.client.ts`
- `tests/integration/client-translation-pipeline.test.ts`

## 작업

통합 테스트를 먼저 작성하고 `src/lib/translation/cached-pipeline.client.ts`에 Phase 2 번역 facade와 Phase 3 번역 캐시를 조합하는 브라우저 전용 애플리케이션 서비스를 구현한다.

- `ChapterSource`, 저장된 모델과 사용자 프롬프트를 받아 기존 `prepareChapterTranslation`으로 캐시 키와 실행 작업을 준비한다.
- 기본 실행에서는 번역 캐시를 먼저 조회하고 hit이면 Gemini 실행 함수를 호출하지 않은 채 원문 순서의 완료 결과를 즉시 반환한다.
- miss이면 기존 실행 함수의 진행 이벤트, 취소, 재시도와 부분 실패 동작을 변경하지 않고 그대로 전달한다.
- 번역 종료 상태가 `complete`이고 모든 원문 문단 ID가 정확히 한 번 존재할 때만 캐시 레코드를 저장한다.
- 캐시 저장 실패는 안전한 별도 persistence 결과로 노출하고 성공한 번역 진행 상태나 문단을 제거하지 않는다.
- `forceRetranslate` 옵션은 캐시 조회를 건너뛰되 캐시 키 계산을 바꾸지 않고 완전 성공 후 동일 키 레코드를 교체한다.
- cache hit, miss, 저장 실패와 강제 재번역 결과 및 이벤트에는 API Key, 사용자 프롬프트 원문, 원문 전체와 Gemini 원시 응답을 포함하지 않는다.
- Phase 3 전체 검증을 실행하고 구현이 문서 계약과 달라진 경우 관련 문서만 갱신한다.

## Acceptance Criteria

- `npm run test -- --run tests/integration/cached-translation-pipeline.test.ts`
- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 검증 절차

1. 동일 장, 모델과 프롬프트의 cache hit가 Gemini test double을 전혀 호출하지 않고 완료 문단을 즉시 반환하는지 확인한다.
2. cache miss가 첫 번역 묶음부터 진행 이벤트를 전달하고 완전 성공 후 검증된 레코드를 저장하는지 확인한다.
3. `contentHash`, 모델 또는 사용자 프롬프트 변경이 miss가 되어 기존 캐시를 잘못 재사용하지 않는지 확인한다.
4. 부분 실패와 취소 결과는 성공 문단을 유지하지만 완전한 캐시 레코드로 저장되지 않는지 확인한다.
5. 캐시 저장 실패가 번역 성공을 유지하고 `STORAGE_FULL` 같은 안전한 저장 상태만 별도로 제공하는지 확인한다.
6. 강제 재번역이 기존 hit를 무시하고 Gemini를 호출한 뒤 완전 성공 결과로 같은 키 레코드를 교체하는지 확인한다.
7. 전체 테스트, 타입 검사, lint와 production build가 통과하는지 확인한다.

## 금지사항

- Phase 2의 분할, Gemini 호출, 출력 검증 또는 재시도 로직을 복제하지 마라. 이유: 이 step은 기존 파이프라인과 캐시의 조합만 담당한다.
- cache hit에서 API Key를 요구하거나 Gemini를 호출하지 마라. 이유: 저장된 번역은 네트워크 없이 즉시 읽을 수 있어야 한다.
- 부분 실패나 취소 결과를 완전한 cache hit로 저장하지 마라. 이유: 이후 방문에서 누락 문단을 완료된 결과로 오인하게 된다.
- 저장 실패를 번역 실패로 덮어쓰지 마라. 이유: 사용자에게 이미 생성된 번역을 계속 제공해야 한다.
- API Key를 준비된 facade 상태, 캐시 레코드, 이벤트, 오류 또는 snapshot에 보존하지 마라. 이유: 키는 Gemini 호출 시점의 브라우저 메모리에서만 사용해야 한다.
- 리더, 설정, 목차 UI 또는 Service Worker를 구현하지 마라. 이유: 사용자 인터페이스와 PWA 통합은 Phase 4의 독립된 책임이다.
