# Step 6: Resume cached translation pipeline

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-07, FR-08, FR-10과 인수 조건 4, 5, 8, 10
- `docs/ARCHITECTURE.md`의 3.5절, 8.1절, 8.2절, 9장, 10장, 13.3절, 15장
- `src/lib/translation/cached-pipeline.client.ts`
- `src/lib/translation/pipeline.client.ts`
- `src/lib/translation/orchestrator.client.ts`
- `src/services/translation-cache.client.ts`
- `src/types/translation.ts`
- `tests/integration/cached-translation-pipeline.test.ts`
- `tests/integration/client-translation-pipeline.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고 cached translation pipeline이 partial progress를 즉시 복원하고 미완료 문단만 재개하도록 연결한다.

- 같은 cache key의 complete record는 기존처럼 즉시 complete hit으로 반환한다.
- partial record는 저장된 번역문을 원문 순서로 첫 progress로 전달하고, 누락 문단만 새 청크로 구성해 sequential orchestrator에 넘긴다.
- 실행 중 검증된 progress를 cache write scheduler에 전달하고, 취소·스트림 종료·부분 실패에서 flush한다.
- 모든 문단이 성공하면 partial state를 complete cache record로 전환하고, 실패·취소 후에는 partial state를 유지한다.
- force retranslate와 명시적 retry는 cache key 무효화·성공분 보존 정책을 깨지 않게 기존 API를 최소 변경한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/integration/cached-translation-pipeline.test.ts tests/integration/client-translation-pipeline.test.ts
npm run typecheck
npm run lint
npm run test
npm run build
git diff --check
```

## 검증 절차

1. 앞 문단 성공 뒤 실패, 새로고침, 취소에서 저장 문단이 먼저 복원되고 누락 ID만 요청되는지 확인한다.
2. partial record가 cache miss/resume으로 처리되고, 전 문단 성공 뒤에는 complete hit으로 전환되는지 확인한다.
3. force retranslate 및 explicit retry가 cache key 재료, API Key 보안 경계, 출력 계약 무재시도 정책을 훼손하지 않는지 확인한다.
4. 실제 Gemini·외부 e-book 호출 없이 integration test, 전체 unit/integration test, typecheck, lint, build와 diff check가 통과하는지 확인한다.

## 금지사항

- 리더 UI, 컴포넌트, Playwright 흐름 또는 `docs/UI_GUIDE.md`를 변경하지 마라. 이유: 이 phase에서는 반복 실패한 UI 통합 step을 의도적으로 제외했다.
- 저장된 문단 ID를 재개 Gemini 요청에 넣지 마라. 이유: 중복 비용과 응답 계약 충돌을 막아야 한다.
- partial progress를 Service Worker cache 또는 서버 상태에 저장하지 마라. 이유: 번역·BYOK 데이터는 IndexedDB 경계 안에만 있어야 한다.
