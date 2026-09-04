# Step 0: Storage contracts

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-04, FR-05, FR-06, FR-08과 인수 조건 8부터 11, 14
- `docs/ARCHITECTURE.md`의 6.2절, 10장, 11장, 14장, 15장
- `src/types/source.ts`
- `src/types/translation.ts`
- `src/lib/translation/models.ts`
- `src/lib/translation/prompt.ts`
- `src/lib/errors.ts`

## 작업

테스트를 먼저 작성하고 브라우저 저장 계층이 공유할 런타임 계약을 `src/types/storage.ts`에 정의한다.

- localStorage에 저장할 번역 설정, 독서 설정과 마지막 독서 위치의 Zod 스키마를 정의하고 TypeScript 타입을 스키마에서 추론한다.
- 번역 설정에는 API Key, 사용자 프롬프트와 번역 모드를 포함하고, 독서 설정에는 보기 모드, 글자 크기와 줄 간격을 포함한다.
- 보기 모드는 `translation`, `original`, `both`만 허용하고 글자 크기는 16px부터 24px까지의 범위로 검증한다.
- 마지막 독서 위치에는 정규화 URL, 음수가 아닌 스크롤 위치와 갱신 시각을 포함한다.
- `TranslationCacheRecord`를 아키텍처 6.2절과 동일한 필드로 정의한다. 번역 문단은 비어 있지 않고 ID가 유일해야 하며 `byteSize`는 음수가 아닌 정수여야 한다.
- `CatalogCacheRecord`에는 정규화된 목차 URL, 검증된 `CatalogSource`, 생성 시각, 접근 시각과 만료 시각을 포함한다.
- 저장 레코드 스키마는 알 수 없는 필드를 거부하여 IndexedDB 레코드에 API Key나 사용자 프롬프트 원문이 섞이면 검증에 실패하게 한다.
- 기본 설정값은 한 곳에서 export하고 기본 번역 모드는 기존 `DEFAULT_TRANSLATION_MODE`를 사용한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/storage-contracts.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 정상 설정, 독서 위치, 번역 캐시와 목차 캐시 레코드가 파싱되고 타입이 스키마에서 추론되는지 확인한다.
2. 지원하지 않는 보기 모드, 범위 밖 글자 크기, 음수 스크롤 위치, 잘못된 시각과 중복 번역 문단 ID를 거부하는지 확인한다.
3. 번역 캐시와 목차 캐시 레코드에 API Key 또는 사용자 프롬프트 원문 필드를 추가하면 거부되는지 확인한다.
4. 기본 설정이 빠른 번역 모드와 PRD가 허용한 독서 설정 범위를 사용하는지 확인한다.

## 금지사항

- 저장소 API나 React 상태를 구현하지 마라. 이유: 이 step은 저장 데이터의 계약만 정의한다.
- 번역 캐시 레코드에 API Key나 사용자 프롬프트 원문을 추가하지 마라. 이유: 비밀값과 사용자 지시문은 캐시 정체성에 필요하지 않다.
- 기존 번역 모델 ID를 다시 하드코딩하지 마라. 이유: 모델 정책은 기존 중앙 카탈로그에서 관리해야 한다.
- 손상된 저장 데이터를 임의로 보정하는 로직을 스키마에 넣지 마라. 이유: 복구 정책은 각 저장 서비스 경계에서 명시적으로 처리해야 한다.
