# Step 4: Gemini client

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 7.1절, FR-03, FR-05, FR-07과 10장
- `docs/ARCHITECTURE.md`의 3.2절, 4장, 9장, 13.3절, 14장, 15장
- `src/types/translation.ts`
- `src/lib/errors.ts`
- `src/lib/translation/models.ts`
- `src/lib/translation/prompt.ts`
- `src/lib/translation/validate-output.ts`

## 작업

테스트를 먼저 작성하고 `src/services/gemini.client.ts`에 브라우저 전용 Gemini API 래퍼를 구현한다.

- 파일에 `client-only` 경계를 적용하고 사용자의 API Key로 브라우저에서 Gemini Developer API를 직접 호출한다.
- API Key 검증용 짧은 요청과 문단 묶음 번역 요청을 명시적인 함수로 제공하되 공통 전송 및 오류 분류 코드는 한 경계 안에서 공유한다.
- 모델 ID는 중앙 카탈로그에서 받은 값만 사용하고 프롬프트 및 구조화 출력 계약을 요청에 적용한다.
- 모든 호출이 `AbortSignal`을 받아 fetch 취소로 전달되게 한다.
- HTTP 상태와 안전한 응답 메타데이터만 사용하여 `INVALID_API_KEY`, `MODEL_UNAVAILABLE`, `QUOTA_EXCEEDED`, `TRANSLATION_BLOCKED`, 재시도 가능한 일시 오류와 일반 `TRANSLATION_FAILED`를 구분한다.
- 원시 응답은 출력 검증기에만 전달하고 오류 메시지, 로그 또는 반환 객체에는 포함하지 않는다.
- fetch를 주입 가능한 의존성으로 두어 실제 네트워크 없이 테스트한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/gemini.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. API Key 검증과 정상 번역이 fetch test double을 통해 올바른 endpoint, 모델, signal과 구조화 요청을 사용하는지 확인한다.
2. 잘못된 키, 권한 없음, 모델 미지원, 할당량, 안전 차단, 429, 5xx와 네트워크 오류의 공개 분류 및 재시도 가능 여부를 확인한다.
3. 취소 신호가 fetch에 전달되고 취소가 일반 네트워크 실패로 변환되지 않는지 확인한다.
4. 앱 서버 Route Handler가 호출되지 않고 API Key가 URL, 공개 오류, 로그와 snapshot에 나타나지 않는지 확인한다.

## 금지사항

- Gemini 요청을 앱 서버나 Route Handler로 보내지 마라. 이유: 사용자의 API Key는 브라우저 밖으로 전송되면 안 된다.
- API Key를 query string, 로그, 오류 객체 또는 snapshot에 넣지 마라. 이유: 비밀값이 브라우저 기록과 개발 도구에 불필요하게 남는다.
- 실패 시 다른 모델을 자동 호출하지 마라. 이유: 사용자가 선택하지 않은 모델이나 비용을 발생시킬 수 있다.
- 실제 Gemini API를 테스트에서 호출하지 마라. 이유: 테스트 결정성과 사용자 할당량을 보호해야 한다.
- 재시도와 동시성 정책을 이 클라이언트에 넣지 마라. 이유: 호출 단위 전송과 전체 번역 orchestration의 책임을 분리해야 한다.
