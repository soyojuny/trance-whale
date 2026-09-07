# Step 4: Sequential progress orchestrator

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 9.2절부터 9.4절, 10장, 14장, 15장
- `src/lib/translation/orchestrator.client.ts`
- `src/services/gemini.client.ts`
- `src/lib/translation/chunk.ts`
- `src/lib/translation/diagnostics.client.ts`
- `src/types/translation.ts`
- `tests/unit/translation-orchestrator.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고, 오케스트레이터가 스트리밍 청크의 검증된 문단을 원문 순서로 즉시 progress 상태에 반영하게 한다.

- 기본 동시성을 1로 변경하고, 후속 청크는 앞 청크가 완료·실패·취소된 뒤에만 시작한다.
- 클라이언트 progress callback에서 온 문단은 한 번만 반영해 `onProgress`로 즉시 전달하고, 실패·취소 후에도 보존한다.
- 새 resume 입력으로 이미 검증된 문단을 받아 source ID와 중복을 검증하고, 비어 있는 문단만 청크화한다.
- 실패·취소 결과는 완료 문단, 미완료 문단 식별자와 실패 범위를 구분할 수 있도록 번역 progress 계약을 최소한으로 확장한다.
- 출력 계약 오류에는 `retry_scheduled` 진단 이벤트를 내지 않고, network·재시도 가능한 5xx만 기존 상한과 backoff로 재시도한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/translation-orchestrator.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 첫 스트리밍 문단이 청크 완료 전 progress로 나타나고 원문 순서를 지키는지 확인한다.
2. 앞 문단 성공 뒤 뒤 문단·청크 실패 또는 취소에서 성공분이 남고 미완료 ID가 정확한지 확인한다.
3. resume 입력의 성공 문단이 재요청에 포함되지 않고, 불연속 누락 문단도 순서를 유지하는지 확인한다.
4. output contract 실패에 자동 재시도 진단이 없고, network 오류만 설정된 상한 안에서 재시도되는지 확인한다.

## 금지사항

- 기본 병렬 처리 또는 앞 청크보다 뒤 청크의 선행 요청을 유지하지 마라. 이유: 앞 문단 우선 표시와 취소 시 토큰 절약을 보장해야 한다.
- 이미 검증된 문단을 실패 결과에서 제거하지 마라. 이유: 부분 저장과 재개가 그 문단을 신뢰한다.
- 실패 원인에 원문·번역문·API Key를 추가하지 마라. 이유: 진단과 저장소의 비밀·콘텐츠 노출을 막아야 한다.
