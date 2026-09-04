# Step 1: Paragraph chunking

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03과 미결정 사항
- `docs/ARCHITECTURE.md`의 6.1절, 9.2절, 15장
- `src/types/source.ts`
- `src/types/translation.ts`
- `src/lib/translation/models.ts`

## 작업

테스트를 먼저 작성하고 `src/lib/translation/chunk.ts`에 순수한 문단 묶음 분할기를 구현한다.

- `ChapterSource.paragraphs` 또는 동일한 문단 배열을 입력받아 원래 순서와 안정적인 문단 ID를 보존한 요청 묶음 배열을 반환한다.
- 문단 중간을 자르지 않고, 묶음의 합산 문자 수가 중앙 설정의 보수적인 기본 한도를 넘기 전에 다음 묶음을 시작한다.
- 기본 한도는 토큰 수로 오인되지 않게 문자 예산임을 이름과 주석에 명시한다. PRD의 정확한 토큰 한도 미결정 상태를 임의로 확정하지 않는다.
- 한 문단 자체가 문자 예산보다 길면 내용 손실이나 무한 루프 없이 단독 묶음으로 반환한다.
- 입력 문단 배열을 변경하지 않고 같은 입력과 설정에는 같은 묶음과 묶음 ID를 반환한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/translation-chunk.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 빈 입력, 한 묶음, 여러 묶음과 정확한 문자 예산 경계를 확인한다.
2. 긴 단일 문단, 다국어 Unicode와 줄바꿈을 내용 손실 없이 처리하는지 확인한다.
3. 모든 입력 ID가 결과에 정확히 한 번, 원래 순서로 존재하는지 확인한다.
4. 입력 객체가 변경되지 않고 반복 호출 결과가 동일한지 확인한다.

## 금지사항

- 문단 중간을 자르지 마라. 이유: PRD가 문단 구조와 대응 관계 보존을 요구한다.
- tokenizer나 무거운 SDK를 이 step만을 위해 추가하지 마라. 이유: 정확한 토큰 정책이 아직 결정되지 않았고 문자 예산으로 충분하다.
- 네트워크 호출이나 React 상태를 추가하지 마라. 이유: 분할기는 독립적으로 검증 가능한 순수 함수여야 한다.
