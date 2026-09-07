# Step 5: Partial translation cache

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 3.5절, 6.2절, 9.3절, 10장, 13.3절, 15장
- `src/types/storage.ts`
- `src/types/translation.ts`
- `src/services/reader-db.client.ts`
- `src/services/translation-cache.client.ts`
- `tests/unit/reader-db.client.test.ts`
- `tests/unit/translation-cache.client.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고, IndexedDB 번역 캐시가 complete record와 partial progress record를 명확히 구분해 저장·읽기·마이그레이션하게 한다.

- partial record에는 검증된 id·번역문, 총 문단 수, 진행 상태와 미완료 또는 실패 문단 식별자를 저장한다.
- partial record는 complete cache hit으로 절대 취급하지 않고, 기존 complete-only record는 계속 읽을 수 있게 한다.
- reader-db 스키마 버전을 올려 안전한 마이그레이션과 하위 호환 parsing을 적용한다.
- progress 저장은 짧은 debounce 또는 검증된 객체 묶음 단위로 coalesce하고, 취소·스트림 종료에서는 대기 중 데이터를 즉시 flush할 수 있는 interface를 제공한다.
- LRU·quota 처리와 byte size 계산이 두 record 종류 모두에서 안전하게 동작하게 한다.
- 구현과 함께 `docs/ARCHITECTURE.md`의 6.2절 및 8장 cache 흐름을 partial/complete 정책으로 갱신한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/reader-db.client.test.ts tests/unit/translation-cache.client.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. partial 저장·읽기·flush에서 검증된 문단, 총량, 미완료·실패 ID가 손실되지 않는지 확인한다.
2. partial record가 complete cache hit을 만들지 않고 기존 complete record가 계속 hit되는지 확인한다.
3. 이전 IndexedDB schema 데이터가 마이그레이션 후 읽히며, byte size·LRU·quota 실패가 적절한 공개 오류를 내는지 확인한다.
4. 레코드, 진단, migration test fixture에 API Key·원문·Gemini raw response가 없는지 확인한다.

## 금지사항

- API Key, 사용자 프롬프트 원문, Gemini raw response를 cache record에 저장하지 마라. 이유: 브라우저 저장소라도 비밀·콘텐츠 보관 경계를 위반한다.
- partial record를 complete와 같은 cache hit으로 반환하지 마라. 이유: 미번역 문단을 완료로 잘못 표시한다.
- EPUB archive나 책 메타데이터를 quota 정리 대상으로 추가하지 마라. 이유: 사용자 확인 없는 archive 삭제는 금지된다.
