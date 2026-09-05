# Step 1: Local EPUB library and reader session

## 읽어야 할 파일

- `AGENTS.md`
- `plan.md`의 데이터 모델 결정과 단계 2
- `docs/PRD.md`의 FR-06, FR-08, FR-09, 10장, 인수 조건 3·8·9·12·13
- `docs/ARCHITECTURE.md`의 IndexedDB·reader session·offline 관련 절
- `src/types/source.ts`, `src/types/storage.ts`
- `src/services/reader-db.client.ts`, `src/services/source-cache.client.ts`, `src/services/translation-cache.client.ts`, `src/services/local-data.client.ts`
- `src/lib/reader/session.client.ts`, `src/lib/translation/cached-pipeline.client.ts`
- `tests/unit/reader-db.client.test.ts`, `tests/unit/reader-session.client.test.ts`, `tests/unit/source-cache.client.test.ts`

## 작업

Step 0의 failing tests와 parser contract를 사용해, local EPUB archive·metadata를 안전하게 저장하고 source API 없이 reader session으로 여는 경계를 구현한다.

- Reader DB를 비파괴적으로 올려 EPUB 책 metadata와 archive Blob을 서로 다른 store에 저장한다. metadata에는 정렬된 chapter locator만 저장하고, archive와 metadata를 사용자 확인 없이 LRU/자동 삭제하지 않는다. 전체 데이터 삭제는 두 store도 함께 제거한다.
- `src/services/local-epub-library.client.ts`에 import, open, storage estimate/persist, quota failure를 캡슐화하는 browser-only service를 둔다. import 전 공간을 확인하고 quota 부족 시 기존 book을 삭제하지 않고 실패한다.
- local chapter를 기존 `ChapterSource` 형태로 source cache에 저장·복원하고 reader session에 `openLocalChapter(bookId, index)`을 추가한다. 이 흐름은 source client/API fetch 없이 cached translation pipeline을 그대로 사용하고, local source는 local locator로만 구분한다.
- last reading position, source cache, catalog cache와 translation cache의 canonical URL validation을 local locator와 호환되게 최소 변경한다. HTTP URL 입력·서버 route 검증은 그대로 유지한다.
- migration, re-open, quota, reset, API 미호출과 local locator server rejection을 먼저 테스트한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/reader-db.client.test.ts tests/unit/local-epub-library.client.test.ts tests/unit/reader-session.client.test.ts tests/unit/local-data.client.test.ts tests/integration/local-epub-*.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 이전 Reader DB의 translation/catalog/source record가 upgrade 뒤에도 보존되는지 확인한다.
2. import한 archive와 metadata가 독립 record이며 새로고침·offline에서 local chapter를 source/Gemini 요청 없이 열 수 있는지 확인한다.
3. quota 부족 시 cache만 LRU 정리 가능하고 archive/metadata는 삭제되지 않는지 확인한다.
4. reset이 EPUB archive와 metadata를 제거하며 API Key·원문·번역이 결과나 오류에 노출되지 않는지 확인한다.

## 금지사항

- archive Blob, EPUB metadata 또는 local locator를 서버 API request에 넣지 마라. 이유: local EPUB은 서버 수집 경로와 분리돼야 한다.
- quota 부족을 해결하기 위해 저장된 EPUB archive나 책 metadata를 자동 삭제하지 마라. 이유: 사용자의 책은 명시적 삭제 전 보존해야 한다.
- 장 원문·번역·목차를 localStorage에 저장하지 마라. 이유: 큰 데이터는 IndexedDB 전용이다.
- 기존 HTTP source client와 SSRF 검증을 local EPUB 처리용으로 재사용하거나 약화하지 마라. 이유: 서로 다른 신뢰 경계다.
