# Step 7: MVP reader E2E

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md` 전체, 특히 7장, 13장과 14장
- `docs/ARCHITECTURE.md`의 4장, 8장, 12장부터 15장
- `docs/UI_GUIDE.md` 전체
- `src/app/`
- `src/components/`
- `src/lib/reader/session.client.ts`
- `src/lib/catalog/session.client.ts`
- `src/services/`
- `package.json`

## 작업

Playwright E2E 테스트를 먼저 작성하고 Phase 4의 화면과 기존 Phase 1~3 경계를 연결해 Trance Whale MVP 핵심 흐름을 완성한다.

- Playwright 설정과 deterministic한 브라우저 테스트 기반을 최소 구성하고 source Route Handler 및 Gemini 요청은 route interception이나 명시적 test double로 대체한다.
- API Key 설정·검증, 지원 URL 입력, source 진행 상태, 첫 번역 문단 표시와 전체 완료까지의 핵심 흐름을 검증한다.
- 원문·번역문·함께 보기, 취소, 부분 실패 재시도, 강제 다시 불러오기와 현재 장 다시 번역을 검증한다.
- 이전 장, 다음 장, 목차 검색·정렬·가상 목록 선택이 모두 앱 내부 reader navigation으로 동작하는지 검증한다.
- 새 브라우저 page 또는 reload에서 저장 설정과 위치가 복원되고 동일 원문·설정 cache hit가 Gemini 요청을 만들지 않는지 검증한다.
- Service Worker가 활성화된 production 형태에서 cached 장의 오프라인 열기와 신규 장의 `OFFLINE` 안내를 검증한다.
- 360px viewport에서 URL 입력부터 장 navigation까지 가로 overflow가 없고 주요 touch target과 sheet가 usable한지 검증한다.
- 키보드만으로 URL 입력, 보기 모드, 목차, 설정, dialog 닫기와 장 이동을 완료하고 focus가 유실되지 않는지 검증한다.
- prototype의 샘플 데이터, 가짜 timeout과 실제 흐름에서 사용되지 않는 중복 상태를 제거하되 문서 기준 스타일은 보존한다.
- 구현과 문서 계약이 달라졌다면 제품 범위를 바꾸지 않는 선에서 관련 문서만 함께 갱신한다.

## Acceptance Criteria

- `npm run test`
- `npm run test:e2e`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 검증 절차

1. API Key가 앱 서버 요청, URL, console, test artifact 또는 snapshot에 나타나지 않으면서 브라우저 Gemini 검증과 번역에만 사용되는지 확인한다.
2. source 수집부터 점진 번역, 세 보기 모드와 장 navigation까지 PRD 인수 조건 1~7을 한 사용자 흐름으로 확인한다.
3. 재방문 cache hit, 설정·콘텐츠 변경 miss, 저장 복원과 전체 삭제로 인수 조건 8~11 및 14를 확인한다.
4. 설치 가능한 PWA, cached offline reading과 신규 작업의 offline 안내로 인수 조건 13을 확인한다.
5. 360px 가로 overflow와 키보드 접근성 회귀가 없는지 확인한다.
6. 전체 unit·integration·E2E 테스트, 타입 검사, lint와 production build가 모두 통과하는지 확인한다.

## 금지사항

- 실제 외부 e-book 사이트나 Gemini API를 E2E 테스트에서 호출하지 마라. 이유: 테스트는 결정적이어야 하고 사용자 키나 외부 상태에 의존해서는 안 된다.
- 테스트 전용 우회 경로가 production에서 활성화되게 하지 마라. 이유: source 및 비밀값 보안 경계를 약화시킬 수 있다.
- 실패하는 검사를 skip, 느슨한 assertion 또는 임의 timeout 증가로 숨기지 마라. 이유: Phase 4의 완료 기준은 재현 가능한 전체 흐름 검증이다.
- 기존 Phase의 보안·캐시 구현을 UI 편의를 위해 우회하지 마라. 이유: 최종 통합에서도 서버 수집과 브라우저 번역 경계를 유지해야 한다.
- MVP 밖의 회원가입, 서재, 동기화, 결제, 전체 책 번역 또는 목차 번역을 추가하지 마라. 이유: PRD 제외 범위를 준수해야 한다.
