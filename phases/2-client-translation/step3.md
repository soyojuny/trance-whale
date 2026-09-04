# Step 3: Translation cache key

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-04, FR-08과 인수 조건 8, 9, 14
- `docs/ARCHITECTURE.md`의 6.2절, 8.1절, 9.1절, 11장, 15장
- `src/types/source.ts`
- `src/types/translation.ts`
- `src/lib/translation/models.ts`
- `src/lib/translation/prompt.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/translation/cache-key.client.ts`에 브라우저 전용 번역 캐시 키 생성기를 구현한다.

- 정규화한 원문 URL, `contentHash`, 모델 ID, 대상 언어 `ko`, 기본 프롬프트 버전과 사용자 프롬프트 해시를 명시적인 필드 순서로 안정적으로 직렬화한다.
- 사용자 프롬프트는 먼저 SHA-256 해시하고 원문을 캐시 키 재료 객체나 반환값에 남기지 않는다.
- 직렬화 결과를 다시 SHA-256으로 해시하여 고정 길이 캐시 키를 반환한다.
- Web Crypto를 얇게 감싸되 해시 구현을 주입하거나 표준 API를 test environment에서 대체할 수 있게 한다.
- 동일 입력의 결정성과 각 구성 요소 변경에 따른 키 무효화를 검증한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/translation-cache-key.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 같은 입력이 반복 호출과 객체 속성 구성 방식에 관계없이 같은 키를 만드는지 확인한다.
2. URL, 원문 해시, 모델, 대상 언어, 기본 프롬프트 버전과 사용자 프롬프트 중 하나만 바뀌어도 키가 달라지는지 확인한다.
3. 반환값과 해시 입력 관찰용 테스트 double에 API Key가 전혀 전달되지 않는지 확인한다.
4. 사용자 프롬프트 원문이 최종 캐시 키나 캐시 키 재료 레코드에 남지 않는지 확인한다.

## 금지사항

- API Key를 함수 인자나 캐시 키 재료에 추가하지 마라. 이유: 키는 번역 결과의 정체성과 무관한 비밀값이다.
- 사용자 프롬프트 원문을 캐시 키 또는 저장 레코드에 넣지 마라. 이유: 해시만으로 무효화 요구사항을 충족할 수 있다.
- 비결정적인 JSON 객체 순서에 의존하지 마라. 이유: 동일 번역에 서로 다른 키가 생길 수 있다.
- IndexedDB 저장소를 구현하지 마라. 이유: 이 step은 순수한 캐시 정체성 계산만 다룬다.
