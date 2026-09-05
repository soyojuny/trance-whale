# Step 0: EPUB contracts and browser parser

## 읽어야 할 파일

- `AGENTS.md`
- `plan.md`의 확정된 경계와 단계 1
- `docs/PRD.md`의 FR-01, FR-07, FR-08, 10장, 인수 조건 2·3·5
- `docs/ARCHITECTURE.md`의 EPUB import·client boundary·storage 관련 절
- `src/types/source.ts`, `src/types/storage.ts`, `src/lib/translation/pipeline.client.ts`
- `package.json`, `package-lock.json`
- `tests/unit/source-contracts.test.ts`, `tests/fixtures/`

## 작업

먼저 실패하는 unit/fixture 계약 테스트를 작성한 뒤, 표준 텍스트 XHTML EPUB을 브라우저에서만 검증·파싱하는 최소 경계를 구현한다.

- `src/types/`에 `local-epub://book/{bookId}/chapter/{index}` locator, EPUB 책·장 metadata와 local chapter/catalog data의 런타임 스키마를 둔다. `ChapterSource`와 translation cache key 입력은 HTTP URL과 local locator를 모두 허용하되, `SourceRequestSchema`와 서버 route 입력은 계속 HTTP(S)만 허용한다.
- `src/lib/epub/*.client.ts`에 `client-only` 경계를 두고 `mimetype`, `META-INF/container.xml`, OPF manifest/spine와 navigation 문서를 검사하는 parser를 만든다. XHTML에서 제목과 텍스트 문단만 정규화해 추출하고 HTML, CSS, 이미지, script, iframe, event handler는 반환·저장·렌더링하지 않는다.
- 중앙 디렉터리 검사를 먼저 수행하는 브라우저 ZIP 의존성을 lockfile에 명시한다. 압축 크기, entry 수, entry별·전체 uncompressed 크기, 장 수와 문단 수의 명시적 상한을 적용해 한도 초과 archive를 해제하지 않는다.
- 파일 바이트와 각 장 content hash는 Web Crypto SHA-256으로 결정적으로 계산한다. 오류는 손상 container, ZIP 한도, XML/XHTML, 빈 장, 잘못된 목차, DRM/이미지 기반 미지원 EPUB을 구분하는 공개 오류로 매핑한다.
- 저작권 문제가 없는 작은 합성 2장 EPUB fixture만 추가한다. 정상 parser, 손상 container, ZIP 한도, XHTML 오류, 빈 장, 잘못된 목차의 rejection을 fixture 기반으로 검증한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/epub-*.test.ts tests/unit/source-contracts.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 정상 fixture에서 book ID, spine 순서, local locator, 제목, 문단과 목차가 결정적으로 추출되는지 확인한다.
2. archive를 해제하기 전 metadata 한도를 초과한 입력과 잘못된 container가 안전한 오류가 되는지 확인한다.
3. parser 결과와 fixture에 raw XHTML, script, style, API Key 또는 실제 사용자 EPUB 내용이 없는지 확인한다.
4. `local-epub://` locator가 `SourceRequestSchema`와 기존 server source route에 계속 거부되는지 확인한다.

## 금지사항

- EPUB Blob 또는 원문을 Route Handler, 서버 로그, 테스트 snapshot에 보내지 마라. 이유: EPUB·원문은 브라우저와 기기 로컬에만 있어야 한다.
- server URL request schema를 local locator까지 허용하도록 완화하지 마라. 이유: local EPUB은 서버 source API의 입력이 아니다.
- raw EPUB XHTML이나 HTML sanitizer 결과를 reader에 전달하지 마라. 이유: 요구사항은 구조화한 텍스트 문단만 렌더링하도록 정한다.
- 실제 사용자가 제공한 EPUB, Playwright/Chrome 확장 또는 원본 사이트 접근 제어 우회 흐름을 추가하지 마라. 이유: 이 단계의 범위와 콘텐츠 경계를 벗어난다.
