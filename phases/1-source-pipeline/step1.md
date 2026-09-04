# Step 1: Source URL validation

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 3.3절, 7.3절, 13.1절, 15장
- `src/types/source.ts`
- `src/lib/errors.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/source/validate-url.server.ts`에 서버 전용 URL 및 DNS 검증을 구현한다.

- MVP 허용 hostname은 정확히 `www.69shuba.com`으로 중앙 관리한다.
- HTTPS만 허용하고 userinfo, fragment, 명시적 비표준 포트를 거부한다. 기본 443 표기는 정규화할 수 있다.
- hostname을 주입 가능한 resolver로 해석하고 모든 IPv4/IPv6 결과가 공인 unicast인지 검사한다.
- 루프백, 사설망, 링크 로컬, 멀티캐스트, unspecified, 문서·예약 주소를 거부한다.
- 검증 성공 시 자격 증명과 fragment가 없는 정규화 URL을 반환한다.
- 파일에 `server-only` 경계를 적용한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/validate-url.server.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 허용 hostname과 공인 DNS 결과가 통과하는지 확인한다.
2. 유사 suffix hostname, IP literal, localhost, userinfo, 비표준 포트와 비 HTTP(S) 프로토콜을 거부하는지 확인한다.
3. DNS 결과 중 하나라도 비공인 주소이면 거부하는지 IPv4와 IPv6 사례로 확인한다.
4. 테스트가 실제 DNS나 네트워크를 호출하지 않는지 확인한다.

## 금지사항

- hostname을 `endsWith`만으로 허용하지 마라. 이유: 공격자가 만든 유사 도메인이 통과할 수 있다.
- DNS 조회를 테스트에서 실제 네트워크에 연결하지 마라. 이유: 테스트는 결정적이고 오프라인이어야 한다.
- 클라이언트 번들에서 이 모듈을 import하지 마라. 이유: SSRF 방어는 서버 경계다.
