# Step 1: Gemini dynamic output schema

## 읽어야 할 파일

- `AGENTS.md`
- `docs/ARCHITECTURE.md`의 3.3절, 9.3절, 13.3절, 15장
- `src/lib/translation/chunk.ts`
- `src/lib/translation/validate-output.ts`
- `src/services/gemini.client.ts`
- `tests/unit/gemini.client.test.ts`
- `tests/unit/translation-output.test.ts`

## 작업

실패하는 테스트를 먼저 작성하고, Gemini 번역 요청의 구조화 출력 스키마를 요청 청크별로 생성한다.

- `translations` 배열의 `minItems`와 `maxItems`를 요청 문단 수와 같게 설정한다.
- 각 순서의 `prefixItems[i]`는 해당 요청 문단 ID 하나만 허용하는 `id.enum`과 비어 있지 않은 `text` 요구사항을 가진다.
- 요청은 기존처럼 브라우저에서 Gemini API로 직접 보내고, `validateTranslationOutput`을 최종 방어선으로 유지한다.
- API Key, 원문, 번역문, Gemini 원시 응답은 진단·공개 오류·test snapshot에 넣지 않는다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/gemini.client.test.ts tests/unit/translation-output.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 1개·복수 문단 요청에서 배열 길이와 `prefixItems` ID 순서가 정확한지 fetch test double로 확인한다.
2. 요청 스키마가 빈 text와 다른 ID를 구조적으로 거부하도록 구성됐는지 확인한다.
3. 모델이 제약을 어겨도 기존 출력 검증기가 누락·중복·순서 오류를 거부하는지 확인한다.
4. 요청 URL, headers, 진단 이벤트와 snapshot에 API Key나 본문이 없는지 확인한다.

## 금지사항

- 출력 계약 검증을 Gemini response schema로 대체하지 마라. 이유: 모델의 구조화 출력만으로 데이터 무결성을 신뢰할 수 없다.
- 모델 ID를 컴포넌트나 새 모듈에 하드코딩하지 마라. 이유: 중앙 모델 카탈로그와 캐시 키 일관성이 필요하다.
- Gemini 요청을 Route Handler로 중계하지 마라. 이유: 사용자의 API Key는 브라우저 밖으로 나가면 안 된다.
