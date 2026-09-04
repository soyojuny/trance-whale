# Step 0: Browser source client

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-01, FR-02, FR-07과 인수 조건 2, 6, 7, 12
- `docs/ARCHITECTURE.md`의 6장부터 8장, 13장, 14장
- `src/types/source.ts`
- `src/lib/errors.ts`
- `src/app/api/source/chapter/route.ts`
- `src/app/api/source/catalog/route.ts`

## 작업

테스트를 먼저 작성하고 `src/services/source-client.client.ts`에 앱의 장·목차 Route Handler만 호출하는 브라우저 전용 source client를 구현한다.

- 파일에 `client-only` 경계를 적용하고 `fetch` 구현을 주입할 수 있게 한다.
- `fetchChapter(url, signal)`과 `fetchCatalog(url, signal)` 인터페이스를 제공하며 각각 `POST /api/source/chapter`, `POST /api/source/catalog`만 호출한다.
- 요청 본문은 `SourceRequestSchema`로 검증하고 URL 외의 API Key, 사용자 프롬프트 또는 번역 설정을 받지 않는 좁은 인터페이스를 유지한다.
- 성공 응답은 각각 `ChapterSourceSchema`, `CatalogSourceSchema`로 다시 검증한 뒤 반환한다.
- 비정상 HTTP 응답과 malformed JSON을 `src/lib/errors.ts`의 공개 오류 계약으로 매핑하고 원본 응답 본문이나 요청 URL을 오류에 포함하지 않는다.
- `AbortSignal`을 그대로 전달하고 취소를 재시도 가능한 source 오류로 바꾸지 않는다.
- source client 자체는 로컬 캐시, React 상태 또는 외부 e-book URL을 직접 다루지 않는다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/source-client.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 장과 목차 요청이 정확한 앱 API 경로, `POST`, JSON content type과 URL만 포함한 본문을 사용하는지 확인한다.
2. 정상 응답이 런타임 스키마를 통과한 구조화 데이터로 반환되는지 확인한다.
3. malformed 성공 응답, 공개 오류 응답과 JSON 해석 실패가 비밀값·원문 본문·upstream 응답 없이 안전한 오류가 되는지 확인한다.
4. 전달한 취소 신호가 fetch에 연결되고 취소 후 추가 요청이 발생하지 않는지 확인한다.

## 금지사항

- 브라우저에서 외부 e-book URL을 직접 fetch하지 마라. 이유: 외부 HTML 수집과 SSRF 방어는 서버 Route Handler의 책임이다.
- API Key, 프롬프트 또는 모델 정보를 source 요청에 넣지 마라. 이유: 앱 서버는 번역 비밀값과 설정을 수신해서는 안 된다.
- 응답의 HTML을 받거나 렌더링하는 인터페이스를 추가하지 마라. 이유: 클라이언트에는 검증된 텍스트와 정규화 URL만 전달해야 한다.
- React hook, 리더 상태 또는 저장 정책을 구현하지 마라. 이유: 이 step은 브라우저 네트워크 경계만 정의한다.
