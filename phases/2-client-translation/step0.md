# Step 0: Translation contracts and models

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03, FR-04, FR-07과 인수 조건 3, 4, 14
- `docs/ARCHITECTURE.md`의 5장, 9.1절, 9.3절, 14장, 15장
- `src/types/source.ts`
- `src/lib/errors.ts`
- `package.json`

## 작업

테스트를 먼저 작성하고 브라우저 번역 파이프라인이 공유할 런타임 계약, 모델 카탈로그와 기본 프롬프트를 구현한다.

- `src/types/translation.ts`에 문단 번역 요청, 구조화 출력, 검증된 묶음 결과와 진행 결과의 Zod 스키마를 정의하고 TypeScript 타입을 스키마에서 추론한다.
- 문단 대응의 핵심 형태는 `{ id: string, text: string }`로 유지하고 ID와 번역문은 비어 있지 않게 검증한다.
- `src/lib/translation/models.ts`에 `fast`와 `quality` 모드, 각각의 모델 ID, 사용자용 상대 속도·품질·비용 가능성 설명을 단일 카탈로그로 정의한다.
- `src/lib/translation/prompt.ts`에 기본 번역 원칙, 안정적인 `BASE_PROMPT_VERSION`, 사용자 프롬프트 최대 길이와 Gemini 요청 지시문 조합 함수를 둔다.
- 사용자 프롬프트는 빈 문자열을 허용하고 기본 지시사항을 대체하지 않고 뒤에 추가한다.
- 기존 공개 오류 계약에 필요한 번역 오류 코드가 모두 존재하는지 테스트하고, 부족한 경우에만 `src/lib/errors.ts`를 최소 수정한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/translation-contracts.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 지원 모델 두 개와 기본 `fast` 선택이 중앙 카탈로그에서만 결정되는지 확인한다.
2. 정상 요청·응답 계약과 빈 ID, 빈 번역문, 중복 ID를 포함한 잘못된 경계 데이터를 검사한다.
3. 빈 사용자 프롬프트와 최대 길이 경계가 통과하고 초과 입력이 거부되는지 확인한다.
4. 조합된 프롬프트에 기본 번역 원칙과 출력 형식 제약이 항상 포함되는지 확인한다.

## 금지사항

- 모델 ID를 Gemini 클라이언트나 컴포넌트에 중복해서 하드코딩하지 마라. 이유: 모델 정책은 단일 설정에서 관리해야 한다.
- 사용자 프롬프트가 기본 출력 형식이나 안전 규칙을 대체하게 하지 마라. 이유: 문단 대응 계약을 신뢰할 수 없게 된다.
- Gemini 호출, 저장소 또는 UI를 구현하지 마라. 이유: 이 step은 번역 도메인 계약과 설정만 다룬다.
- API Key를 타입, 프롬프트, 오류 fixture 또는 snapshot에 넣지 마라. 이유: 비밀값의 전파 경로를 만들지 않아야 한다.
