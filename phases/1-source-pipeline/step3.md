# Step 3: 69shuba chapter extractor

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-02와 성공 지표
- `docs/ARCHITECTURE.md`의 3.1절, 3.3절, 6.1절, 13.2절
- `src/types/source.ts`
- `src/lib/source/validate-url.server.ts`

## 작업

fixture 계약 테스트를 먼저 작성하고 공통 추출기 계약·레지스트리와 69shuba 장 추출을 구현한다.

- `src/lib/extractors/extractor.ts`에 문서의 `SiteExtractor` interface와 정확한 hostname 기반 레지스트리를 둔다.
- `src/lib/extractors/shuba69.server.ts`에 사이트 전용 selector, URL 정규화, 광고 제거 규칙을 격리한다.
- `tests/fixtures/69shuba/`에 실행 코드와 분리된 대표 장 HTML fixture를 둔다.
- 제목, 가능한 작품/장 식별자와 번호, 순서가 안정적인 문단 ID, 본문 텍스트, 이전/목차/다음 절대 URL을 추출한다.
- 정규화된 본문을 기반으로 결정적인 SHA-256 content hash를 생성한다.
- 빈 본문이나 합리적인 최소 기준보다 짧은 결과는 추출 실패로 처리한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/shuba69-chapter-extractor.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. fixture에서 본문 순서와 탐색 링크가 정확히 추출되는지 확인한다.
2. 메뉴, 광고, script, style, iframe과 이벤트 속성의 내용이 결과에 없는지 확인한다.
3. 같은 입력의 문단 ID와 content hash가 안정적인지 확인한다.
4. 빈/짧은 본문 fixture가 안전한 추출 오류가 되는지 확인한다.

## 금지사항

- 실제 69shuba 네트워크를 테스트에서 호출하지 마라. 이유: 추출기 계약은 저장 fixture로 재현 가능해야 한다.
- 원본 HTML 조각을 결과에 반환하지 마라. 이유: 클라이언트에는 textContent와 정규화 URL만 전달해야 한다.
- 사이트 selector를 공통 레지스트리나 Route Handler에 두지 마라. 이유: 사이트별 규칙은 어댑터 내부에 격리해야 한다.
