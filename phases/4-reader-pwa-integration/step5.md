# Step 5: Reader navigation and position

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 7.2절, 7.3절, FR-06, FR-06-1, FR-08과 인수 조건 5부터 10
- `docs/ARCHITECTURE.md`의 8장, 10장, 11장
- `docs/UI_GUIDE.md`의 5장, 6장, 7.1절, 11장, 13장
- `src/app/page.tsx`
- `src/lib/reader/session.client.ts`
- `src/components/catalog-sheet.tsx`
- `src/services/preferences.client.ts`

## 작업

통합 테스트를 먼저 작성하고 App Router의 `/read?url=...` 화면에서 홈, 이전 장, 다음 장과 목차 선택을 하나의 앱 내부 navigation 흐름으로 연결한다.

- `src/app/read/page.tsx`는 URL query를 읽는 얇은 Server Component 경계로 두고 브라우저 API와 reader session 실행은 별도 Client Component에 둔다.
- 홈 URL 제출, 이어 읽기, `ChapterSource.navigation.previous/next`와 목차 장 선택은 모두 URL을 안전하게 encode한 `/read?url=...` 상태로 이동한다.
- navigation 대상 URL은 source client가 서버 Route Handler에 보내기 전까지 브라우저에서 외부 fetch하거나 iframe으로 열지 않는다.
- 새 장 이동 시 이전 session을 취소하고 새 본문의 시작으로 이동하되, 같은 canonical URL의 저장된 위치가 있으면 해당 위치 복원을 우선한다.
- 현재 canonical URL과 scroll position을 preferences service에 저장하고 scroll listener는 작은 throttle을 적용하며 unmount 시 마지막 위치를 반영한다.
- 이전 또는 다음 장이 없으면 실제 `disabled` 상태와 비활성 이유를 접근성 이름 또는 설명으로 제공한다.
- 데스크톱 하단 장 이동 영역과 모바일 고정 도구막대가 같은 navigation 명령을 사용하고 모바일 safe area 및 본문 하단 여백을 적용한다.
- browser history의 뒤로·앞으로 이동도 새로운 reader session을 열며 이전 비동기 결과가 화면을 덮어쓰지 않게 한다.

## Acceptance Criteria

- `npm run test -- --run tests/integration/reader-navigation.test.tsx`
- `npm run typecheck`
- `npm run lint`

## 검증 절차

1. 홈, 이전·다음과 목차 선택이 모두 인코딩된 앱 내부 reader URL을 만들고 원본 사이트 navigation을 발생시키지 않는지 확인한다.
2. 장 전환이 이전 fetch와 번역을 취소하고 새 session만 화면 상태를 갱신하는지 확인한다.
3. 처음 여는 장은 시작 위치로, 저장된 같은 canonical URL은 기존 scroll position으로 복원되는지 확인한다.
4. throttle된 scroll 저장과 unmount 최종 저장이 다른 장의 위치를 덮어쓰지 않는지 확인한다.
5. 비어 있는 이전·다음 target, 모바일 도구막대와 browser history 이동이 접근성 및 상태 불변조건을 지키는지 확인한다.

## 금지사항

- 원본 장 링크를 `<a href>`의 외부 navigation 대상으로 사용하지 마라. 이유: 원본 페이지는 앱 안에서 실행하거나 직접 표시하지 않는다.
- scroll 이벤트마다 동기적으로 localStorage에 쓰지 마라. 이유: 긴 글 스크롤 성능을 저하시킬 수 있다.
- canonical URL이 다른 장의 위치를 복원하지 마라. 이유: 독서 위치는 해당 장 정체성과 함께 검증해야 한다.
- Client Component에서 `window.location`으로 전체 페이지를 강제 reload하지 마라. 이유: App Router navigation과 현재 독서 상태를 활용해야 한다.
- 목차 또는 설정 UI를 다시 구현하지 마라. 이유: 이 step은 기존 컴포넌트의 navigation과 위치 저장 통합만 담당한다.
