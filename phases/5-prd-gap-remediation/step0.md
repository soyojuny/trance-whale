# Step 0: Offline source cache storage

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 High: 실제 오프라인에서 저장된 장을 열 수 없음
- `docs/PRD.md`의 FR-02, FR-08, FR-09와 인수 조건 8, 11, 13
- `docs/ARCHITECTURE.md`의 3.4절, 6.1절, 11장, 12장
- `src/types/source.ts`, `src/types/storage.ts`
- `src/services/reader-db.client.ts`, `src/services/translation-cache.client.ts`, `src/services/catalog-cache.client.ts`
- `tests/unit/reader-db.client.test.ts`, `tests/unit/translation-cache.client.test.ts`

## 작업

테스트를 먼저 작성하고 `ChapterSource`를 브라우저 IndexedDB에 안전하게 저장·조회하는 source cache 저장 경계를 구현한다.

- `ReaderDatabase` 스키마를 비파괴적으로 다음 버전으로 올리고, canonical URL을 key로 하는 source cache store를 추가한다. 기존 translation·catalog store와 레코드는 upgrade 뒤에도 읽혀야 한다.
- source cache record는 캐시 식별자, 저장 시각과 `ChapterSource`만 포함한다. 읽을 때 `ChapterSourceSchema`로 재검증하고, 손상된 레코드는 cache miss로 취급한다.
- `src/services/source-cache.client.ts`에 작은 주입식 `SourceCache` 인터페이스를 둔다. `get(canonicalUrl)`과 `put(chapter)`의 실패는 안전하게 결과로 반환하고, DB 예외·원문 전체를 UI 오류로 노출하지 않는다.
- 온라인 source cache는 원문 메타데이터와 탐색 링크를 보존해야 하며 translation cache와 독립적으로 동작해야 한다.
- API Key, 사용자 프롬프트, 선택 모델, 번역문 또는 Gemini 응답을 source cache record에 넣지 않는다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/reader-db.client.test.ts tests/unit/source-cache.client.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 기존 version의 translation·catalog 레코드를 가진 DB를 열고 upgrade한 뒤 두 레코드가 보존되는지 확인한다.
2. source cache가 제목, 문단, 콘텐츠 해시와 이전·다음·목차 navigation을 손실 없이 반환하는지 확인한다.
3. 손상된 source record와 IndexedDB 실패가 API Key, 프롬프트 또는 원문을 노출하지 않는 cache miss/안전한 실패가 되는지 확인한다.
4. 저장 레코드와 test fixture에 API Key가 없는지 확인한다.

## 금지사항

- Service Worker Cache Storage에 chapter source를 저장하지 마라. 이유: Service Worker는 앱 셸과 정적 자산만 캐시해야 한다.
- translation cache의 key 또는 레코드를 source cache 용도로 재사용하지 마라. 이유: source 복원은 정규화 URL로 찾고 번역 재사용은 콘텐츠 해시를 포함한 별도 키로 판정해야 한다.
- source cache에서 API Key, 프롬프트 또는 번역문을 저장하지 마라. 이유: 저장소 경계와 비밀값 보존 규칙을 위반한다.
