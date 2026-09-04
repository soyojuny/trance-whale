# Step 2: Translation output validation

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-07과 인수 조건 3, 4
- `docs/ARCHITECTURE.md`의 6.1절, 9.3절, 9.4절, 14장, 15장
- `src/types/translation.ts`
- `src/lib/errors.ts`
- `src/lib/translation/prompt.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/translation/validate-output.ts`에 Gemini 구조화 출력 검증기를 구현한다.

- 원시 응답과 해당 요청 묶음을 입력받아 검증된 `{ id, text }` 번역 배열 또는 분류 가능한 내부 번역 오류를 반환한다.
- JSON 구문과 런타임 스키마를 검사한 뒤 요청한 모든 ID가 정확히 한 번, 요청 순서대로 존재하는지 확인한다.
- 누락, 중복, 요청하지 않은 ID, 빈 번역문과 순서 변경을 계약 실패로 분류한다.
- Markdown code fence, 해설 또는 구조화 결과 바깥의 임의 텍스트를 관대하게 제거하지 않고 계약 실패로 처리한다.
- 공개 오류에는 원시 Gemini 응답, 원문 또는 번역문이 포함되지 않게 한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/translation-output.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 요청 ID와 순서가 정확한 정상 JSON 결과가 통과하는지 확인한다.
2. malformed JSON, 누락, 중복, 추가 ID, 순서 변경과 빈 번역문이 거부되는지 확인한다.
3. JSON을 code fence나 설명으로 감싼 결과를 성공으로 보정하지 않는지 확인한다.
4. 발생한 공개 오류와 테스트 snapshot에 원시 응답이나 본문 문자열이 포함되지 않는지 확인한다.

## 금지사항

- 위치만으로 원문과 번역문을 대응하지 마라. 이유: 안정적인 문단 ID로 누락과 순서 변경을 검출해야 한다.
- 잘못된 응답을 정렬하거나 누락 문단을 만들어 성공 처리하지 마라. 이유: 번역 대응 오류를 숨기게 된다.
- 오류 메시지에 Gemini 원문 응답을 연결하지 마라. 이유: 사용자 콘텐츠와 외부 응답이 노출될 수 있다.
- 재시도나 네트워크 로직을 구현하지 마라. 이유: 이 step은 출력 계약 검증만 담당한다.
