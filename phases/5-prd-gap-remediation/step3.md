# Step 3: Partial failure feedback

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 Medium: 부분 실패의 구체적인 원인을 사용자에게 표시하지 않음
- `docs/PRD.md`의 FR-06, FR-07과 인수 조건 4
- `docs/ARCHITECTURE.md`의 9.4절, 10장, 14장
- `docs/UI_GUIDE.md`의 3.2절, 6.2절, 11장
- `src/lib/errors.ts`, `src/lib/reader/session.client.ts`
- `src/components/reader/reader-view.tsx`
- `tests/unit/reader-session.client.test.ts`, `tests/unit/reader-view.test.tsx`

## 작업

테스트를 먼저 작성하고 selective retry 결과를 reader session과 reader UI에 연결하여 부분 실패의 안전한 원인을 표시한다.

- `retryFailedTranslation()`은 현재 `partial_failure`의 실패 chunk ID와 성공 번역을 Step 2의 부분 재시도 인터페이스로 전달한다.
- partial failure 상태의 `PublicError[]`는 오류 코드 기준으로 중복 제거하고, UI에는 정의된 사용자 메시지만 표시한다. upstream 응답, 원문, 스택 트레이스와 API Key를 렌더링하지 않는다.
- 실패한 오류 중 하나라도 `retryable`일 때만 `실패한 문단 다시 번역` 동작을 제공한다. 모두 재시도 불가면 재시도 불가 사유를 텍스트로 안내하고 버튼을 제공하지 않는다.
- 기존 성공 문단, 실패 문단의 재시도 안내, 완료 문단 수와 진행률이 partial retry 동안 일관되게 보존되어야 한다.
- `role="alert"`, 버튼 이름 등 현재 접근성 패턴을 유지한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/reader-session.client.test.ts tests/unit/reader-view.test.tsx
npm run typecheck
npm run lint
```

## 검증 절차

1. quota, safety policy, 일시적 번역 오류가 각각 공개 메시지로 표시되고 중복 메시지가 하나만 보이는지 확인한다.
2. 재시도 가능한 partial failure가 성공 문단을 유지한 채 실패 chunk만 재실행하는지 확인한다.
3. 재시도 불가 오류만 있는 경우 재시도 버튼이 렌더링되지 않는지 확인한다.
4. rendered DOM과 test snapshots에 API Key, 원문 upstream 응답, 원시 예외가 없는지 확인한다.

## 금지사항

- 오류 객체를 `String(error)` 또는 원시 HTTP 응답으로 렌더링하지 마라. 이유: 비밀값과 외부 응답이 사용자에게 노출될 수 있다.
- 모든 partial failure에 재시도 버튼을 표시하지 마라. 이유: 안전 정책 차단·권한 오류처럼 재시도로 해결되지 않는 상태를 오도한다.
- 부분 재시도 중 성공 문단을 빈 placeholder로 되돌리지 마라. 이유: FR-07은 성공한 문단을 유지하도록 요구한다.
