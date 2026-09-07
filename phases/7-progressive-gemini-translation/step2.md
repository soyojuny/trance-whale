# Step 2: SSE incremental JSON parser

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 9.3절, 9.4절, 13.3절, 15장
- `src/types/translation.ts`
- `src/lib/translation/validate-output.ts`
- `src/services/gemini.client.ts`
- `tests/unit/gemini.client.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고, 브라우저 전용 스트림에서 완결된 번역 객체만 추출하는 작은 증분 SSE·JSON 파서를 추가한다.

- `TextDecoder` streaming 모드로 바이트를 처리해 UTF-8 코드 포인트가 chunk 경계에서 끊겨도 복원한다.
- SSE event 경계와 data payload를 누적하고, `translations` 배열 내 완결된 객체만 한 번씩 파싱한다.
- 문자열 이스케이프·중첩 구조를 고려해 JSON 문자열 내부의 중괄호·대괄호를 객체 경계로 오인하지 않는다.
- 빈 thought-signature 또는 text 없는 part는 무시하고, 연결 중단 시 불완전 객체를 결과나 로그에 노출하지 않는다.
- parser는 순수하게 완결 객체 후보만 제공하며 ID 순서·최종 계약 검증은 호출자가 수행하게 한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/gemini.client.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 임의의 SSE 및 UTF-8 경계에서도 이스케이프된 따옴표를 포함한 완결 객체가 한 번만 나오는지 확인한다.
2. 객체 일부, 부분 단어, 잘린 event와 연결 중단이 progress 후보를 만들지 않는지 확인한다.
3. 여러 data event와 빈 text part를 처리해도 이미 전달한 객체를 중복 전달하지 않는지 확인한다.
4. 테스트 fixture와 오류 assertion에 원문·번역문 전문 또는 API Key가 남지 않는지 확인한다.

## 금지사항

- 스트림 전체 또는 원시 SSE payload를 진단 로그·오류 객체에 보관하지 마라. 이유: 원문과 번역문이 노출될 수 있다.
- 불완전 JSON을 복구하려고 추측하거나 렌더링하지 마라. 이유: 잘린 번역문을 사용자에게 표시하면 안 된다.
- 이 step에서 네트워크 호출이나 리더 UI를 변경하지 마라. 이유: 파서의 결정적 동작을 독립적으로 검증해야 한다.
