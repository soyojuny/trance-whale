# Step 3: Streaming Gemini client

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-05, FR-07과 10장
- `docs/ARCHITECTURE.md`의 3.3절, 9.3절, 9.4절, 13.3절, 14장, 15장
- `src/services/gemini.client.ts`
- `src/lib/translation/validate-output.ts`
- `src/lib/translation/diagnostics.client.ts`
- `src/lib/translation/chunk.ts`
- `tests/unit/gemini.client.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고 `src/services/gemini.client.ts`의 청크 번역을 Gemini `streamGenerateContent` SSE 호출로 확장한다.

- 기존 API Key 검증 경로는 유지하고, 번역 요청만 dynamic schema와 SSE endpoint를 사용한다.
- 완결 객체가 파서에서 나오면 예상한 다음 문단 ID와 정확히 일치할 때만 progress callback으로 전달한다.
- 스트림 종료 시 누적된 응답의 전체 출력 계약을 다시 검증하고, 이미 전달된 객체와 최종 결과의 불일치·누락·중복은 `TranslationOutputError`로 거부한다.
- `AbortSignal`을 fetch에 전달하고 취소를 일반 번역 실패로 변환하지 않는다.
- 기존 안전한 Gemini 응답 메타데이터와 토큰 수 진단은 유지하되 본문·raw response·API Key는 절대 기록하지 않는다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/gemini.client.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. fetch test double이 streaming endpoint, POST body, API Key header와 signal을 올바르게 받는지 확인한다.
2. 앞 문단은 즉시 callback으로 전달되고, 뒤 문단이 아직 불완전하면 전달되지 않는지 확인한다.
3. 종료 시 전체 검증이 누락·중복·순서 오류를 거부하며 안전·HTTP·network 오류 분류를 유지하는지 확인한다.
4. 취소·연결 중단이 이미 검증된 callback 문단을 되돌리거나 공개 오류에 원시 payload를 포함하지 않는지 확인한다.

## 금지사항

- API Key나 Gemini 요청을 앱 서버, Service Worker 또는 Route Handler로 보내지 마라. 이유: BYOK 보안 경계를 위반한다.
- 스트림 객체를 ID 검증 전 callback으로 전달하지 마라. 이유: 리더가 잘못된 문단 대응을 표시할 수 있다.
- 출력 계약 실패에 클라이언트 내부 재시도를 추가하지 마라. 이유: 재시도 정책은 오케스트레이터가 통제하며 계약 오류는 무재시도다.
