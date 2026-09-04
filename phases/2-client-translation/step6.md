# Step 6: Translation pipeline integration

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-03부터 FR-05, FR-07, FR-08과 인수 조건 3, 4, 8, 9, 14
- `docs/ARCHITECTURE.md`의 6장, 8.1절, 9장부터 11장, 14장, 15장
- `src/types/source.ts`
- `src/types/translation.ts`
- `src/lib/translation/chunk.ts`
- `src/lib/translation/cache-key.client.ts`
- `src/lib/translation/orchestrator.client.ts`
- `src/services/gemini.client.ts`

## 작업

통합 테스트를 먼저 작성하고 Phase 1의 `ChapterSource`를 클라이언트 번역 파이프라인에 연결하는 얇은 facade를 구현한다.

- `ChapterSource`, 저장된 모델 선택, 사용자 프롬프트와 호출 시점에만 제공되는 API Key를 받아 캐시 키와 실행 가능한 장 번역 작업을 준비한다.
- 문단 분할, Gemini 호출, 출력 검증과 오케스트레이션의 기존 인터페이스를 조합하고 각 모듈의 책임을 중복 구현하지 않는다.
- 진행 이벤트에는 API Key, 원문 전체, 사용자 프롬프트 또는 원시 Gemini 응답을 포함하지 않고 문단 ID별 성공 결과와 안전한 공개 상태만 노출한다.
- 모델·프롬프트·원문 변경에 따른 캐시 키 무효화와 번역 실행 결과를 함께 통합 검증한다.
- 통합 테스트에서도 Gemini와 시간은 test double로 대체하고 실제 네트워크를 호출하지 않는다.
- Phase 2 전체 검증을 실행하고 구현과 문서 계약이 달라졌다면 관련 문서만 갱신한다.

## Acceptance Criteria

- `npm run test -- --run tests/integration/client-translation-pipeline.test.ts`
- `npm run test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 검증 절차

1. `ChapterSource`의 모든 문단이 분할, 요청, 검증을 거쳐 원래 ID와 순서대로 완료되는지 확인한다.
2. 첫 묶음 결과가 전체 번역 전 노출되고 429 및 출력 누락이 해당 묶음만 재시도되는지 확인한다.
3. 일부 묶음 영구 실패와 취소가 이미 성공한 문단을 유지한 안전한 상태로 반환되는지 확인한다.
4. 잘못된 API Key와 모델 미지원이 재시도나 자동 모델 변경 없이 공개 오류로 반환되는지 확인한다.
5. 동일 설정과 원문은 같은 캐시 키를 만들고 모델, 사용자 프롬프트 또는 `contentHash` 변경은 다른 키를 만드는지 확인한다.
6. 전체 테스트, 타입 검사, lint와 production build가 통과하는지 확인한다.

## 금지사항

- 리더 UI, 설정 UI 또는 React 상태를 구현하지 마라. 이유: 이 phase는 UI가 소비할 번역 파이프라인까지만 완성한다.
- IndexedDB, localStorage 또는 Service Worker를 구현하지 마라. 이유: 영속 저장과 PWA는 후속 phase의 독립된 책임이다.
- API Key를 facade 상태, 캐시 키, 이벤트, 로그 또는 오류 결과에 보존하지 마라. 이유: 키는 Gemini 호출 순간에만 브라우저 메모리에서 사용해야 한다.
- 실제 source 사이트나 Gemini API를 테스트에서 호출하지 마라. 이유: 통합 테스트는 외부 시스템과 사용자 할당량에 독립적이어야 한다.
- 서버 모듈에서 클라이언트 번역 facade를 import하지 마라. 이유: 번역과 API Key 처리 경계를 브라우저로 제한해야 한다.
