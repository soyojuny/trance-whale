# Step 3: Translation cache

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-08, 성능 요구사항과 인수 조건 8, 9, 11, 14
- `docs/ARCHITECTURE.md`의 6.2절, 8.1절, 11장, 14장, 15장
- `src/types/storage.ts`
- `src/types/translation.ts`
- `src/services/reader-db.client.ts`
- `src/lib/translation/cache-key.client.ts`
- `src/lib/errors.ts`

## 작업

테스트를 먼저 작성하고 `src/services/translation-cache.client.ts`에 번역 결과 전용 IndexedDB 저장소와 용량 정책을 구현한다.

- 파일에 `client-only` 경계를 적용하고 Step 2의 DB adapter와 현재 시각을 주입받을 수 있게 한다.
- `get`, `put`, `delete`와 전체 번역 캐시 삭제 인터페이스를 제공하며 모든 입력과 DB 출력은 Step 0의 스키마로 검증한다.
- cache hit 시 번역 문단의 ID와 순서를 그대로 반환하고 `accessedAt`을 현재 시각으로 갱신한다.
- UTF-8 직렬화 크기를 기준으로 레코드 `byteSize`를 결정적으로 계산하고 호출자가 제공한 값을 신뢰하지 않는다.
- 기본 최대 용량을 100MB로 두고 새 레코드 저장 전 필요한 공간만큼 가장 오래 접근한 레코드부터 제거한다.
- IndexedDB quota 오류가 발생하면 LRU 항목을 추가로 제거하고 동일 저장을 한 번만 재시도한다.
- 정리 후에도 저장할 수 없으면 안전한 `STORAGE_FULL` 결과를 반환하되 호출자가 가진 번역 결과를 변경하지 않는다.
- 완전한 장 번역만 받는 저장 인터페이스를 사용하고 부분 결과나 실패 chunk가 포함된 실행 결과는 거부한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/translation-cache.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 저장과 조회가 문단 ID 및 순서를 보존하고 조회할 때 `accessedAt`만 갱신하는지 확인한다.
2. 동일한 레코드가 항상 같은 `byteSize`를 계산하고 다국어 UTF-8 문자열의 byte 크기를 올바르게 반영하는지 확인한다.
3. 100MB 경계에서 최근 사용 항목은 보존하고 가장 오래된 항목부터 필요한 만큼만 제거하는지 확인한다.
4. quota 오류 후 정리와 재시도가 정확히 한 번 발생하고 반복 실패는 `STORAGE_FULL`로 종료되는지 확인한다.
5. API Key, 사용자 프롬프트 원문과 부분 번역 상태가 DB adapter에 전달되지 않는지 확인한다.

## 금지사항

- 모든 항목을 지우는 방식으로 용량을 확보하지 마라. 이유: PRD는 최근 사용 순서의 선택적 정리를 요구한다.
- quota 오류를 무제한 재시도하지 마라. 이유: 종료되지 않는 쓰기와 불필요한 데이터 삭제를 방지해야 한다.
- 저장 실패 때문에 이미 완료된 번역 결과를 실패로 바꾸지 마라. 이유: 캐시 영속화와 번역 성공은 서로 다른 결과다.
- 부분 실패 번역을 완전한 cache hit로 저장하지 마라. 이유: 현재 캐시 계약에는 완전성이나 실패 범위를 표현하는 필드가 없다.
- 캐시 키를 이 서비스에서 다시 조합하지 마라. 이유: 캐시 정체성은 기존 `cache-key.client.ts`의 단일 구현을 사용해야 한다.
