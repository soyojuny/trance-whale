# Step 0: Source domain contracts

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-01, FR-02, FR-07과 인수 조건
- `docs/ARCHITECTURE.md`의 5장, 6장, 7장, 14장
- `package.json`

## 작업

테스트를 먼저 작성하고 source API 경계에서 사용할 도메인 타입과 런타임 스키마를 구현한다.

- Zod 계열 검증기로 `ChapterSource`, `CatalogSource`, 탐색 대상, 문단, 목차 장, `{ url: string }` 요청을 검증한다.
- 타입은 스키마에서 추론하여 런타임 계약과 TypeScript 타입의 중복을 피한다.
- `PublicErrorCode` 전체와 `{ code, message, retryable }` 공개 오류 계약을 구현한다.
- 내부 예외나 upstream 응답을 공개하지 않고 알려진 공개 오류로 만드는 최소 매핑 함수를 구현한다.
- 필요한 패키지만 고정 설치하고 기존 Next/React 버전을 불필요하게 변경하지 않는다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/source-contracts.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 정상 장·목차 데이터가 스키마를 통과하는지 확인한다.
2. 빈 본문, 잘못된 URL, 중복되거나 잘못된 문단 ID 등 잘못된 경계 데이터가 거부되는지 확인한다.
3. 공개 오류에 원본 예외 메시지와 응답 본문이 포함되지 않는지 확인한다.

## 금지사항

- Route Handler나 fetch 코드를 구현하지 마라. 이유: 이 step은 도메인 계약 레이어만 다룬다.
- API Key, 사용자 프롬프트 또는 번역 결과 필드를 source API 계약에 추가하지 마라. 이유: 서버가 번역 비밀값을 수신해서는 안 된다.
- TypeScript 타입과 런타임 스키마를 별도로 중복 선언하지 마라. 이유: 두 계약의 불일치를 방지해야 한다.
