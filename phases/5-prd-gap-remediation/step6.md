# Step 6: PRD validation evidence

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 5단계부터 8단계
- `docs/PRD.md` 전체, 특히 13장과 14장
- `docs/ARCHITECTURE.md`의 15장부터 17장
- `docs/ADR.md`, `docs/UI_GUIDE.md`
- `tests/fixtures/69shuba/`
- `tests/e2e/mvp-reader.spec.ts`

## 작업

구현 완료 근거와 아직 사람의 확인이 필요한 PRD 성공 지표를 구분해 문서화한다. 이 step은 외부 사이트나 실제 Gemini API를 호출하지 않는다.

- source fixture 계약, 번역 문단 대응, navigation, cache hit/miss, 360px UI 및 E2E가 어떤 PRD 인수 조건을 검증하는지 추적 가능한 validation 문서를 추가한다.
- 10개 중국어 장의 자연스러움·의미 보존·고유명사 일관성 평가표와 계산 방법을 제공하되, 실제 API Key와 사람 평가 없이 점수나 95%/99% 성공률을 달성했다고 주장하지 않는다.
- source cache와 selective retry라는 새 결정의 이유·트레이드오프를 실제 내용의 ADR로 기록한다. 템플릿 placeholder는 이번에 다루는 ADR 영역에서 남기지 않는다.
- `docs/PRD.md`의 문서 상태는 실제 수동 품질·배포 검증 전까지 `Draft`로 유지한다. `main` 병합, tag 생성, push 또는 배포는 수행하지 않는다.

## Acceptance Criteria

```bash
npm run test
npm run typecheck
npm run lint
git diff --check
```

## 검증 절차

1. 모든 PRD 인수 조건이 자동 테스트 근거, 수동 검증 필요 또는 미검증으로 명시적으로 분류되는지 확인한다.
2. 10장 품질 평가표에 Key·원문 전문·번역문 전문을 기록하도록 요구하지 않는지 확인한다.
3. ADR이 실제 선택, 이유와 트레이드오프를 설명하고 template placeholder를 재사용하지 않는지 확인한다.
4. PRD가 실제 완료라고 잘못 표시되지 않는지 확인한다.

## 금지사항

- 실제 Gemini API 또는 외부 e-book 사이트를 자동 테스트·문서 생성에서 호출하지 마라. 이유: 테스트 결정성과 사용자 API Key의 브라우저 전용 경계를 보장해야 한다.
- 수동 품질 평가 전에 성공률 또는 품질 목표가 달성되었다고 기록하지 마라. 이유: PRD 성공 지표의 근거를 위조할 수 있다.
- 이 step에서 `main` 병합, 원격 push 또는 배포를 수행하지 마라. 이유: 배포 통합은 전체 검증과 별도 승인 뒤에만 해야 한다.
