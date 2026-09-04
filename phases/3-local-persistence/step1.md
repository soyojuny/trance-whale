# Step 1: Local preferences

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 7.1절, 7.3절, FR-04, FR-05, FR-08과 인수 조건 10, 11, 14
- `docs/ARCHITECTURE.md`의 10장, 11장, 13.3절, 15장
- `src/types/storage.ts`
- `src/lib/translation/models.ts`
- `src/lib/translation/prompt.ts`
- `src/lib/errors.ts`

## 작업

테스트를 먼저 작성하고 `src/services/preferences.client.ts`에 작은 설정과 마지막 독서 위치를 관리하는 localStorage 서비스를 구현한다.

- 파일에 `client-only` 경계를 적용하고 Storage 호환 객체를 주입받을 수 있게 하여 실제 브라우저 없이 테스트한다.
- 번역 설정, 독서 설정과 마지막 독서 위치에 앱 전용이며 버전이 명시된 개별 저장 키를 사용한다.
- `loadPreferences`, `savePreferences`, `loadReadingPosition`, `saveReadingPosition`과 앱 소유 키만 지우는 함수를 명시적으로 제공한다.
- 저장값을 읽을 때 JSON과 Step 0의 런타임 스키마를 검증하고, 누락되거나 손상된 설정은 안전한 기본값으로 복구한다.
- API Key와 사용자 프롬프트는 사용자가 저장을 요청한 완성된 설정 객체를 저장할 때만 기록하고 작성 중인 draft를 자동 저장하지 않는다.
- 직렬화, quota와 Storage 접근 실패를 원본 값이나 예외 메시지를 노출하지 않는 안전한 결과로 반환한다.
- 탭 간 동기화가 후속 UI에서 필요할 때 사용할 수 있도록 앱 설정 키 변경만 식별하는 순수 helper를 제공한다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/preferences.client.test.ts`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 저장 후 새 서비스 인스턴스에서 API Key, 프롬프트, 모델, 독서 설정과 마지막 위치가 복원되는지 확인한다.
2. 저장값 누락, malformed JSON과 스키마 불일치가 예외나 원문 노출 없이 기본값으로 복구되는지 확인한다.
3. 저장 실패가 작성 중 값을 별도로 기록하거나 공개 오류에 API Key를 포함하지 않는지 확인한다.
4. clear 함수가 앱 소유 키만 제거하고 주입된 Storage의 무관한 키는 보존하는지 확인한다.
5. 다른 탭의 무관한 storage 이벤트는 무시하고 앱 설정 키 변경만 식별하는지 확인한다.

## 금지사항

- localStorage 전체를 `clear()`하지 마라. 이유: 같은 origin에서 애플리케이션과 무관한 데이터를 삭제할 수 있다.
- API Key를 URL, 로그, 오류 메시지, 이벤트 payload 또는 테스트 snapshot에 넣지 마라. 이유: 비밀값의 불필요한 노출을 막아야 한다.
- 본문, 번역 결과 또는 목차를 localStorage에 저장하지 마라. 이유: 큰 데이터는 IndexedDB에만 저장해야 한다.
- 설정 draft를 입력할 때마다 자동 저장하지 마라. 이유: UI 가이드는 명시적인 저장 전후 상태를 구분한다.
- React hook이나 컴포넌트를 추가하지 마라. 이유: 이 step은 UI와 독립된 브라우저 저장 서비스만 다룬다.
