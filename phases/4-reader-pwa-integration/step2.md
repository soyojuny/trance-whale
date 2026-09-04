# Step 2: Home and settings flow

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 7.1절, 7.3절, FR-01, FR-03부터 FR-05, FR-08과 인수 조건 1, 10, 11, 14
- `docs/ARCHITECTURE.md`의 9.1절, 10장, 11장, 13.3절
- `docs/UI_GUIDE.md`의 5장, 6.1절, 7장, 8장, 11장부터 13장
- `src/app/page.tsx`
- `src/components/reader-prototype.tsx`
- `src/services/gemini.client.ts`
- `src/services/preferences.client.ts`
- `src/services/local-data.client.ts`
- `src/lib/translation/models.ts`
- `src/lib/translation/prompt.ts`

## 작업

Testing Library 테스트를 먼저 작성하고 홈 URL 입력과 설정 sheet를 실제 브라우저 서비스에 연결하는 Client Component를 `src/components/` 아래에 구현한다.

- 홈은 제품 설명, 라벨이 있는 장 URL 입력, 지원 도메인 안내와 `번역해서 읽기` 동작을 제공하고 유효한 제출을 앱 내부 `/read?url=...`로 연결한다.
- 저장된 마지막 독서 위치가 있으면 URL과 민감한 경로 정보를 과도하게 노출하지 않는 `이어 읽기` 진입점을 제공한다.
- 설정 sheet는 글자 크기, 사용자 프롬프트, 번역 모델과 Gemini API Key를 편집하며 저장된 값과 session draft를 명확히 분리한다.
- API Key 입력은 기본 `password`이고 sheet를 다시 열 때 숨김 상태로 초기화하며 텍스트가 있는 표시·숨기기 버튼을 제공한다.
- 최초 Key 저장 또는 변경 저장 전 `validateApiKey`를 브라우저에서 직접 호출하고 검증 성공 후에만 완성된 설정 객체를 preferences service에 저장한다.
- 변경사항 저장 전에는 현재 장 다시 번역을 비활성화하고, 저장 성공 후에도 현재 장을 자동 폐기하지 않고 명시적 재번역 callback만 제공한다.
- 프롬프트 최대 길이와 글자 수, 두 모델의 상대적 속도·품질·비용 가능성을 중앙 모델 카탈로그에서 표시한다.
- API Key의 브라우저 저장 한계, Gemini 데이터 처리, 무료 등급 데이터 사용 가능성과 외부 콘텐츠 책임 안내를 입력 가까이에 제공한다.
- 전체 데이터 삭제는 명시적 확인 뒤 local data service를 호출하고 부분 실패 영역을 안전하게 안내한다.
- sheet는 dialog 이름, `Escape`, 초기 focus, 닫은 뒤 focus 복원과 배경 상호작용 차단을 지원한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/home-settings-flow.test.tsx`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. URL 제출과 이어 읽기가 외부 사이트로 직접 이동하지 않고 인코딩된 앱 내부 reader URL을 만드는지 확인한다.
2. API Key가 기본 마스킹되고 Key 검증이 앱 Route Handler가 아닌 주입한 Gemini client를 직접 호출하는지 확인한다.
3. draft 변경, 저장 실패, 저장 성공과 현재 장 재번역 활성 상태가 UI 가이드의 순서를 지키는지 확인한다.
4. 설정을 닫았다 다시 열 때 session draft는 유지되지만 Key 표시 상태는 숨김으로 초기화되는지 확인한다.
5. 전체 삭제 확인, 취소, 성공과 부분 실패가 앱 소유 저장소만 대상으로 동작하는지 확인한다.
6. 키보드 focus 이동·복원과 접근성 이름을 Testing Library로 확인한다.

## 금지사항

- API Key를 Server Action, Route Handler, URL, 로그, 오류 문구 또는 snapshot으로 전달하지 마라. 이유: 키는 브라우저 밖으로 나가면 안 된다.
- 입력 draft를 키 입력마다 localStorage에 자동 저장하지 마라. 이유: 명시적인 검증 및 저장 흐름을 지켜야 한다.
- 저장 직후 현재 장을 자동 재번역하지 마라. 이유: 기존 결과는 사용자의 명시적 선택 전까지 유지해야 한다.
- 모델 ID와 설명을 컴포넌트에 다시 하드코딩하지 마라. 이유: 모델 정책은 중앙 카탈로그가 단일 기준이다.
- 프로토타입의 샘플 소설 데이터나 가짜 진행 상태를 실제 흐름에 남기지 마라. 이유: Phase 4는 실제 서비스 경계를 통합해야 한다.
