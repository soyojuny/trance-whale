# Step 7: Offline E2E validation

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 High 발견 사항과 5단계 E2E 환경 복구 요구사항
- `docs/PRD.md`의 FR-06부터 FR-09, 비기능 요구사항, 인수 조건 4, 8, 13
- `docs/ARCHITECTURE.md`의 12장, 15장
- `docs/UI_GUIDE.md`의 5.2절, 6.2절, 11장, 13장
- `playwright.config.ts`, `tests/e2e/mvp-reader.spec.ts`
- `src/lib/reader/session.client.ts`, `src/services/source-cache.client.ts`

## 작업

Playwright E2E를 먼저 보강하여 source mock이 응답할 수 없는 실제 offline 조건에서 cached chapter를 새로고침해 복원하는 흐름을 검증한다.

- 초기 온라인 방문에서 source·translation cache를 채운 뒤 source/Gemini route interception을 제거하거나 명시적으로 요청 실패하게 만든다.
- `context.setOffline(true)`와 `navigator.onLine === false` 상태에서 앱 셸을 새로고침하고, source API·Gemini 요청 없이 cached title, 원문, 번역문, navigation이 표시되는지 검증한다.
- 저장되지 않은 chapter는 같은 offline 조건에서 `OFFLINE` 안내를 표시하고 source/Gemini 요청을 만들지 않는지 검증한다.
- partial failure의 선택 재시도가 성공 chunk를 다시 보내지 않는지 E2E 또는 적절한 request-level 통합 테스트로 보강한다.
- Chromium mobile 360px 검증과 기존 keyboard flow를 유지한다. 현재 환경에 Chromium 또는 WebKit runtime이 없으면 test를 skip·완화·timeout 증가로 숨기지 말고 정확한 `blocked_reason`을 남긴다.

## Acceptance Criteria

```bash
npm run test:e2e
npm run test
npm run typecheck
npm run lint
npm run build
git diff --check
```

## 검증 절차

1. offline reload 동안 source·Gemini request count가 증가하지 않는지 확인한다.
2. cached chapter의 제목, 원문, 번역문, 이전·다음·목차 navigation이 모두 렌더링되는지 확인한다.
3. unknown chapter가 offline에서 `OFFLINE`으로 끝나고 stale route mock으로 성공하지 않는지 확인한다.
4. 360px에서 가로 overflow와 44px 미만의 주요 touch target 회귀가 없는지 확인한다.
5. E2E, unit·integration, typecheck, lint, build가 모두 통과하는지 확인한다.

## 금지사항

- 실제 원본 사이트나 실제 Gemini API를 E2E에서 호출하지 마라. 이유: 테스트가 외부 상태·사용자 비밀값에 의존하면 안 된다.
- offline 검증 중 source route mock을 유지하지 마라. 이유: mock 응답은 실제 source cache 복원을 가릴 수 있다.
- browser runtime 부족을 test skip, 느슨한 assertion 또는 임의 timeout 증가로 감추지 마라. 이유: E2E 통과 근거가 아닌 환경 차단을 명확히 남겨야 한다.
- `/api/`, Gemini 또는 외부 e-book 요청을 Service Worker cache에 추가하지 마라. 이유: PWA 저장소 보안 경계를 위반한다.
