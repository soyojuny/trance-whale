# Step 4: Catalog cache

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-02, FR-06-1, FR-08과 성능 요구사항
- `docs/ARCHITECTURE.md`의 6.1절, 8.3절, 11장, 15장
- `src/types/source.ts`
- `src/types/storage.ts`
- `src/services/reader-db.client.ts`

## 작업

테스트를 먼저 작성하고 `src/services/catalog-cache.client.ts`에 목차 전용 IndexedDB 저장소와 24시간 만료 정책을 구현한다.

- 파일에 `client-only` 경계를 적용하고 Step 2의 DB adapter와 현재 시각을 주입받을 수 있게 한다.
- 정규화된 목차 URL을 키로 `get`, `put`, `delete`와 전체 목차 캐시 삭제 인터페이스를 제공한다.
- 저장 시 `CatalogSourceSchema`와 `CatalogCacheRecord` 스키마를 모두 검증하여 장 ID, URL, 제목과 `sourceIndex` 순서를 보존한다.
- 기본 TTL은 24시간으로 중앙 상수화하고 `expiresAt` 이전 레코드만 fresh cache hit로 반환한다.
- 만료된 레코드는 네트워크를 직접 호출하거나 자동 삭제하지 않고 stale 상태와 함께 반환하여 후속 호출자가 갱신을 결정할 수 있게 한다.
- fresh 조회 시 `accessedAt`을 갱신하되 `createdAt`과 `expiresAt`은 변경하지 않는다.
- 2,000개 이상의 장을 가진 목차도 잘림이나 순서 변경 없이 저장하고 복원한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/catalog-cache.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 24시간 이전 조회는 fresh hit, 정확한 만료 경계와 이후 조회는 stale 결과가 되는지 확인한다.
2. fresh 조회가 접근 시각만 갱신하고 TTL을 무한히 연장하지 않는지 확인한다.
3. 2,000개 이상의 장에서 원본 순서, `sourceIndex`, 장 번호와 URL이 그대로 복원되는지 확인한다.
4. malformed DB 레코드는 성공으로 사용하지 않고 안전한 저장 실패 또는 miss로 분류되는지 확인한다.
5. 만료 조회가 실제 source route나 외부 네트워크를 호출하지 않는지 확인한다.

## 금지사항

- 목차 제목을 번역하지 마라. 이유: 목차 번역은 MVP 제외 사항이다.
- stale 조회 안에서 source API를 호출하지 마라. 이유: 캐시 정책과 데이터 수집 흐름을 분리해야 한다.
- 조회할 때마다 `expiresAt`을 연장하지 마라. 이유: 새 장 추가 여부를 24시간마다 다시 확인해야 한다.
- 목차 전체를 localStorage에 저장하지 마라. 이유: 큰 데이터는 IndexedDB에 저장해야 한다.
- 가상 목록이나 검색 UI를 구현하지 마라. 이유: 이 step은 목차 데이터의 저장과 만료 정책만 다룬다.
