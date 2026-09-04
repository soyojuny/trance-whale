# Step 4: Chapter source route

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 7.1절, 7.3절, 8.1절, 14장
- `src/types/source.ts`
- `src/lib/errors.ts`
- `src/lib/source/fetch-source.server.ts`
- `src/lib/extractors/extractor.ts`
- `src/lib/extractors/shuba69.server.ts`

## 작업

통합 테스트를 먼저 작성하고 `src/app/api/source/chapter/route.ts`를 구현한다.

- Node.js runtime을 명시하고 `{ url }` JSON 요청의 content-type, body 크기와 런타임 스키마를 검증한다.
- URL 검증, 안전 fetch, 추출기 선택, 장 추출, 성공 응답 스키마 검증을 연결한다.
- 성공과 오류 응답 모두 `Cache-Control: no-store`를 적용한다.
- 공개 오류는 코드, 안전한 사용자 메시지, retryable만 반환하고 상태 코드를 일관되게 매핑한다.
- 테스트에서 fetch와 DNS를 대체할 수 있도록 서버 파이프라인 로직을 Route Handler의 얇은 HTTP 경계와 분리한다.

## Acceptance Criteria

- `npm run test -- --run tests/integration/chapter-source-route.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 정상 fixture 기반 요청이 `ChapterSource`와 `no-store`를 반환하는지 확인한다.
2. 잘못된 JSON/URL, 미지원 사이트, 접근 실패, 과대 응답, 추출 실패의 공개 오류를 확인한다.
3. 응답과 기록 가능한 오류에 API Key, 원본 HTML, upstream 본문이 없는지 확인한다.

## 금지사항

- API Key나 사용자 프롬프트를 요청에서 받지 마라. 이유: 앱 서버는 번역 관련 비밀값을 수신해서는 안 된다.
- Route Handler에서 사이트 selector를 직접 사용하지 마라. 이유: 파싱 규칙은 추출기 어댑터의 책임이다.
- 테스트에서 실제 외부 네트워크를 호출하지 마라. 이유: 통합 테스트는 결정적이어야 한다.
