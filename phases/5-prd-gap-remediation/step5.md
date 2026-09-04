# Step 5: HTTP URL normalization

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 Low: HTTP URL 정책이 클라이언트와 서버에서 다름
- `docs/PRD.md`의 FR-01
- `docs/ARCHITECTURE.md`의 8.1절, 13.1절
- `src/services/source-client.client.ts`
- `src/components/home-settings-flow.tsx`, `src/app/read/page.tsx`
- `src/lib/source/validate-url.server.ts`
- `tests/unit/source-client.client.test.ts`, `tests/unit/home-settings-flow.test.tsx`, `tests/unit/validate-url.server.test.ts`

## 작업

테스트를 먼저 작성하고 browser source 경계에서 입력 `http` URL을 안전하게 `https` URL로 정규화하여 URL 입력과 서버 HTTPS 정책을 일치시킨다.

- chapter와 catalog 요청 모두에서 URL parser가 유효하다고 판단한 `http` URL은 동일 host·path·query를 보존한 `https` URL로 바뀐 뒤 앱 Route Handler로 전달되어야 한다.
- invalid URL은 기존처럼 `INVALID_URL`로, HTTPS로 정규화된 미지원 host는 서버의 `UNSUPPORTED_SITE` 흐름으로 처리한다.
- 서버의 HTTPS-only, 포트, 사용자 정보, 허용 host, DNS와 redirect 검증을 완화하거나 browser로 옮기지 않는다.
- URL query로 직접 `/read`에 진입하는 흐름도 같은 source client 경계를 통과하게 하여 홈과 reader의 정책 차이를 남기지 않는다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/source-client.client.test.ts tests/unit/home-settings-flow.test.tsx tests/unit/validate-url.server.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 허용 host의 HTTP chapter·catalog 입력이 HTTPS request body로 source API에 전달되는지 확인한다.
2. HTTPS URL과 query·fragment가 의도치 않게 손실되지 않는지 확인한다.
3. malformed URL, 사용자 정보 또는 비표준 포트가 서버 검증에서 계속 거부되는지 확인한다.
4. browser가 외부 e-book URL을 직접 fetch하지 않는지 확인한다.

## 금지사항

- 서버 URL 검증에서 HTTP를 허용하지 마라. 이유: 수집 URL의 HTTPS-only SSRF 정책은 유지되어야 한다.
- 허용 여부를 browser의 문자열 suffix 검사만으로 판단하지 마라. 이유: hostname 허용과 DNS 검증은 서버 보안 경계의 책임이다.
- 외부 URL로 이동하거나 직접 fetch하는 fallback을 추가하지 마라. 이유: 원본 HTML 수집은 Route Handler에서만 수행해야 한다.
