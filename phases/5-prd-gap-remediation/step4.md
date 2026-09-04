# Step 4: API Key deletion

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 Medium: API Key만 개별 삭제할 수 없음
- `docs/PRD.md`의 FR-05, FR-08과 인수 조건 10, 11
- `docs/ARCHITECTURE.md`의 11장, 13.3절
- `docs/UI_GUIDE.md`의 7.5절, 8장, 11장
- `src/components/home-settings-flow.tsx`
- `src/services/preferences.client.ts`, `src/services/local-data.client.ts`, `src/services/gemini.client.ts`
- `tests/unit/home-settings-flow.test.tsx`, `tests/unit/preferences.client.test.ts`

## 작업

테스트를 먼저 작성하고 settings 흐름에 API Key만 명시적으로 삭제하는 확인 단계를 추가한다.

- 기본 마스킹과 표시/숨기기 동작을 유지한다. 저장된 Key가 있는 경우에만 명확한 삭제 동작을 제공하고, destructive action에는 확인 단계를 둔다.
- key 삭제는 Gemini 검증 요청 없이 preferences의 API Key만 제거한다. 사용자 프롬프트, 모델, reader 설정, 마지막 읽기 위치, IndexedDB source·translation·catalog cache는 유지해야 한다.
- key 삭제 뒤 settings draft와 화면 상태가 실제 저장된 값과 일치하고, 다시 저장하거나 새 Key를 입력하는 흐름이 계속 동작해야 한다.
- 삭제 또는 저장 상태 메시지에는 key 문자열을 포함하지 않는다.
- UI guide의 destructive action 기준과 충돌하는 표현이 생기면 해당 부분만 동기화한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/home-settings-flow.test.tsx tests/unit/preferences.client.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 저장된 Key 삭제가 Gemini fetch 없이 API Key preference만 제거하는지 확인한다.
2. 삭제 뒤 프롬프트, 모델, 글자 설정과 cache record가 그대로 남는지 확인한다.
3. 취소한 확인 dialog는 저장된 Key와 현재 draft를 변경하지 않는지 확인한다.
4. 삭제 UI가 키보드로 조작 가능하고 비밀값을 렌더링·snapshot·오류에 넣지 않는지 확인한다.

## 금지사항

- 빈 API Key를 일반 저장 경로에서 Gemini 검증으로 보내지 마라. 이유: 빈 값은 유효성 실패가 아니라 명시적 삭제 의도다.
- API Key 삭제에 전체 local data reset을 연결하지 마라. 이유: FR-05의 개별 삭제가 프롬프트와 읽기 cache를 보존해야 한다.
- API Key를 확인 문구, toast, URL 또는 test fixture에 넣지 마라. 이유: 비밀값이 브라우저 외부와 영구 산출물에 남아서는 안 된다.
