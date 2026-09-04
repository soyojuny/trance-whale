# Step 5: Translation orchestrator

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-07과 성능 요구사항
- `docs/ARCHITECTURE.md`의 8.1절, 9.2절부터 10장, 14장, 15장
- `src/types/source.ts`
- `src/types/translation.ts`
- `src/lib/errors.ts`
- `src/lib/translation/chunk.ts`
- `src/lib/translation/validate-output.ts`
- `src/services/gemini.client.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/translation/orchestrator.client.ts`에 한 장의 번역 작업을 조정하는 브라우저 전용 오케스트레이터를 구현한다.

- 분할된 묶음을 앞에서부터 작은 고정 동시성 한도 안에서 시작하고, 완료된 `{ id, text }` 문단과 전체 완료 문단 수를 콜백 또는 비동기 이벤트 인터페이스로 즉시 전달한다.
- 최종 결과는 성공 문단, 실패 묶음, 전체 문단 수와 `complete`, `partial_failure`, `cancelled`, `failed` 중 하나의 종료 상태를 구분한다.
- 네트워크 오류, 429, 재시도 가능한 5xx와 출력 계약 실패만 제한 횟수 내에서 지수 백오프와 jitter로 재시도한다.
- sleep, jitter와 Gemini 호출을 의존성으로 주입하여 테스트가 실제 시간이나 네트워크에 의존하지 않게 한다.
- API Key, 권한, 모델 미지원과 안전 정책 오류는 재시도하지 않는다.
- 외부 `AbortSignal`과 내부 `AbortController`를 연결해 사용자 취소 또는 장 전환 시 대기와 남은 요청을 중단한다.
- 한 묶음의 영구 실패가 이미 성공한 문단을 제거하거나 성공 묶음을 다시 요청하게 하지 않는다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/translation-orchestrator.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 첫 묶음 완료가 전체 완료 전 전달되고 진행률이 완료 문단 수 기준으로 단조 증가하는지 확인한다.
2. 동시 요청 수가 설정 상한을 넘지 않고 최종 성공 문단이 원문 순서로 정렬되는지 확인한다.
3. 429, 재시도 가능한 5xx, 네트워크 오류와 출력 계약 실패가 상한까지만 재시도되는지 확인한다.
4. 비재시도 오류, 일부 영구 실패와 사용자 취소가 각각 올바른 종료 상태가 되며 기존 성공 결과를 유지하는지 확인한다.
5. 테스트가 실제 timeout 대기나 네트워크 호출 없이 결정적으로 완료되는지 확인한다.

## 금지사항

- 실패 시 무제한 재시도하지 마라. 이유: 사용자 할당량 소모와 종료되지 않는 작업을 방지해야 한다.
- 일부 실패 시 성공한 문단을 폐기하지 마라. 이유: PRD가 부분 성공 유지와 실패 범위 재시도를 요구한다.
- 취소를 일반 실패로 표시하지 마라. 이유: 사용자가 의도한 중단과 장애를 구분해야 한다.
- React 컴포넌트나 전역 상태 라이브러리를 추가하지 마라. 이유: 오케스트레이터는 UI와 독립적인 클라이언트 도메인 로직이어야 한다.
- IndexedDB 저장을 결합하지 마라. 이유: 저장 실패가 번역 실행 상태를 오염시키지 않도록 후속 phase에서 별도 통합한다.
