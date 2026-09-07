# Step 0: Chunk paragraph limits

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 9.2절, 9.3절, 15장
- `src/lib/translation/chunk.ts`
- `src/types/translation.ts`
- `tests/unit/translation-chunk.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고 `src/lib/translation/chunk.ts`의 기본 청크 정책을 문단 수와 문자 수로 함께 제한한다.

- 기본값을 최대 24문단 및 원문 2,000자로 중앙 상수화하고, 호출자가 두 제한을 명시적으로 재정의할 수 있게 한다.
- 문단 ID와 원문 순서를 유지하고 문단 중간을 자르지 않는다.
- 단일 문단이 문자 예산을 초과하면 그 문단 하나만 담은 청크로 분리한다.
- 청크 ID는 같은 입력과 설정에서 결정적으로 생성한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/translation-chunk.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 짧은 문단 25개가 24개와 1개의 청크로 나뉘는지 확인한다.
2. 2,000자 제한을 넘는 다음 문단이 새 청크에서 시작하고, 문단 텍스트가 분할되지 않는지 확인한다.
3. 예산 초과 단일 문단과 잘못된 양의 정수 아닌 제한값을 검증한다.
4. 기존 호출이 의도 없이 6,000자 또는 병렬 처리 정책을 유지하지 않는지 확인한다.

## 금지사항

- 문단을 문자 단위로 나누지 마라. 이유: Gemini 응답의 문단 ID 대응 계약을 보장할 수 없다.
- 토큰 추정기나 외부 모델 호출을 추가하지 마라. 이유: 이번 정책은 검증 가능한 문자·문단 상한만 사용한다.
- 오케스트레이터의 동시성 정책을 이 step에서 바꾸지 마라. 이유: 순차 스트리밍은 후속 step의 책임이다.
