# Step 2: Safe source fetch

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 7.3절, 13.1절, 14장
- `src/lib/source/validate-url.server.ts`
- `src/lib/errors.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/source/fetch-source.server.ts`에 제한된 외부 HTML fetch를 구현한다.

- URL 검증기와 fetch 구현을 의존성으로 주입할 수 있게 하여 실제 네트워크 없는 테스트를 지원한다.
- redirect를 수동 처리하고 제한된 횟수 안에서 각 목적지를 다시 URL/DNS 검증한다.
- 연결을 포함한 전체 요청 timeout과 최대 응답 byte를 제한한다.
- 성공 응답은 허용 HTML content-type만 받고 문자 인코딩 정보를 보존하거나 올바르게 디코딩한다.
- cookie, authorization, 사용자 제공 header를 전달하지 않는다.
- 실패는 안전한 내부 오류로 분류하며 upstream 본문을 오류에 포함하지 않는다.
- 파일에 `server-only` 경계를 적용한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/fetch-source.server.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 정상 HTML 응답과 허용된 리다이렉트를 확인한다.
2. redirect loop/상한, 재검증 실패, timeout, 비 HTML, 과대 응답을 확인한다.
3. 요청에 비밀 header나 cookie가 포함되지 않는지 확인한다.
4. 모든 테스트가 fetch test double만 사용하는지 확인한다.

## 금지사항

- 자동 redirect 추적을 사용하지 마라. 이유: 각 redirect 목적지에 SSRF 검증을 반복해야 한다.
- 응답 전체를 제한 없이 `text()`로 읽지 마라. 이유: 최대 응답 크기를 실제 읽기 과정에서 강제해야 한다.
- upstream 응답 본문을 사용자 오류에 넣지 마라. 이유: 외부 콘텐츠와 민감 정보 노출을 막아야 한다.
