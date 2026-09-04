# Step 2: Reader database

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-08과 인수 조건 8, 9, 11
- `docs/ARCHITECTURE.md`의 6.2절, 10장, 11장, 14장, 15장
- `src/types/storage.ts`
- `src/lib/errors.ts`
- `package.json`

## 작업

테스트를 먼저 작성하고 `src/services/reader-db.client.ts`에 IndexedDB 연결, 스키마 upgrade와 트랜잭션을 캡슐화한 브라우저 전용 저수준 adapter를 구현한다.

- 파일에 `client-only` 경계를 적용하고 `IDBFactory` 또는 동등한 최소 factory 인터페이스를 주입받을 수 있게 한다.
- 데이터베이스 이름과 버전, 번역 캐시와 목차 캐시 object store 이름을 한 곳에서 관리한다.
- 번역 캐시는 `cacheKey`를, 목차 캐시는 정규화된 목차 URL을 primary key로 사용한다.
- LRU 정리를 위해 번역 캐시의 `accessedAt`을 순회할 수 있는 index를 정의한다.
- open, upgrade, readonly/readwrite transaction 완료와 실패를 Promise 기반의 작은 인터페이스로 제공한다.
- DB 차단, transaction abort, quota와 알 수 없는 IndexedDB 실패를 원본 레코드나 브라우저 예외 본문 없이 분류한다.
- 상위 저장소가 원자적 읽기·쓰기·삭제·cursor 순회를 구현할 수 있는 최소 연산만 노출한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/reader-db.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 최초 open에서 두 object store와 필요한 index가 정확히 한 번 생성되는지 확인한다.
2. 기존 버전 open에서는 레코드가 삭제되거나 불필요한 upgrade가 실행되지 않는지 확인한다.
3. 읽기와 쓰기 transaction이 완료 시 resolve되고 request 오류, abort와 blocked 상황에서 안전하게 실패하는지 확인한다.
4. 주입한 IndexedDB test double만 사용하며 테스트가 실제 브라우저 저장 상태에 의존하지 않는지 확인한다.

## 금지사항

- 저장 정책, TTL 또는 캐시 hit 판단을 이 adapter에 넣지 마라. 이유: 저수준 DB 수명 주기와 도메인 캐시 정책을 분리해야 한다.
- API Key나 사용자 프롬프트를 받는 인터페이스를 만들지 마라. 이유: IndexedDB는 해당 비밀 설정의 저장 위치가 아니다.
- 스키마 upgrade 시 기존 store를 무조건 삭제하지 마라. 이유: 사용자의 번역과 목차 데이터를 불필요하게 잃게 된다.
- 실제 네트워크나 React 상태를 추가하지 마라. 이유: DB adapter는 독립적으로 검증 가능한 브라우저 저장 경계여야 한다.
- 이 step만을 위해 무거운 IndexedDB wrapper 의존성을 추가하지 마라. 이유: 필요한 표면이 작고 주입 가능한 최소 adapter로 충분하다.
