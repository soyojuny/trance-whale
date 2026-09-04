# Step 1: Reader session controller

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 7.2절, FR-03, FR-07, FR-08과 인수 조건 3, 4, 8, 9, 14
- `docs/ARCHITECTURE.md`의 8장부터 10장, 14장
- `src/types/source.ts`
- `src/types/storage.ts`
- `src/types/translation.ts`
- `src/services/source-client.client.ts`
- `src/services/preferences.client.ts`
- `src/lib/translation/cached-pipeline.client.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/reader/session.client.ts`에 장 수집과 캐시된 번역 파이프라인을 조율하는 브라우저 전용 reader session controller와 순수 reducer를 구현한다.

- `idle`, `fetching_source`, `parsing_response`, `checking_cache`, `translating`, `complete`, `partial_failure`, `cancelled`, `failed` 상태를 구별하는 discriminated union을 정의한다.
- `openChapter`는 source client에서 `ChapterSource`를 받은 뒤 저장된 번역 설정으로 기존 cached pipeline을 실행한다.
- 번역 진행 이벤트마다 완료된 문단을 원문 ID 순서로 상태에 반영하여 전체 완료 전에도 소비자가 읽을 수 있게 한다.
- controller가 생성한 `AbortController` 하나로 source fetch와 해당 장의 남은 번역 요청을 취소하며 새 장을 열 때 이전 작업의 늦은 결과를 무시한다.
- 일부 chunk 실패 시 성공 문단과 실패 범위를 유지하고 기존 파이프라인이 허용하는 실패 범위 재시도 동작을 노출한다.
- `forceReload`는 source API를 다시 호출하고, `forceRetranslate`는 기존 source에 대해 캐시 조회를 건너뛰되 둘의 의미를 분리한다.
- 오류 상태에는 공개 오류 코드, 사용자용 메시지와 재시도 가능 여부만 두고 API Key, 프롬프트, 원문 전체, 번역문 전체 또는 원시 예외를 넣지 않는다.
- controller 생성 시 source client, cached pipeline과 설정 조회 함수를 주입하여 실제 네트워크와 브라우저 저장소 없이 테스트한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/reader-session.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 장 열기가 정의된 상태 순서를 거쳐 cache hit와 miss 모두 완료 상태에 도달하는지 확인한다.
2. 번역 진행 이벤트가 도착할 때마다 완료 문단이 원문 순서로 증가하고 미완료 문단과 잘못 섞이지 않는지 확인한다.
3. 취소와 빠른 장 전환 후 이전 요청의 늦은 결과가 새 세션 상태를 덮어쓰지 않는지 확인한다.
4. 부분 실패가 성공 문단을 보존하고 실패 범위 재시도 후 상태를 올바르게 갱신하는지 확인한다.
5. 강제 source 재수집과 캐시를 건너뛴 재번역이 서로의 네트워크 경계를 잘못 실행하지 않는지 확인한다.

## 금지사항

- Phase 1의 source 수집이나 Phase 2·3의 번역, 재시도, 캐시 로직을 복제하지 마라. 이유: controller는 기존 경계를 조합하는 역할만 해야 한다.
- API Key를 reducer state, 이벤트 또는 오류 객체에 보존하지 마라. 이유: 비밀값은 Gemini 호출 시점의 메모리에만 있어야 한다.
- 전역 상태 라이브러리를 추가하지 마라. 이유: 아키텍처는 가까운 Client Component와 작은 reducer를 요구한다.
- UI markup이나 CSS를 구현하지 마라. 이유: 이 step은 화면과 독립적인 세션 상태 및 명령 경계만 다룬다.
