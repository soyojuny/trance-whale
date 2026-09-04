---
name: review
description: 현재 코드 변경사항을 프로젝트 아키텍처, 기술 결정, 테스트, CRITICAL 규칙과 빌드 가능성 기준으로 리뷰할 때 사용한다.
---

# Project Review

먼저 `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/ADR.md` 중 존재하는 문서를 읽는다. 그다음 `git status`, staged diff와 unstaged diff를 확인하고 변경 범위에 맞는 검사 명령을 실행한다.

다음 항목을 검증한다.

1. `docs/ARCHITECTURE.md`에 정의된 구조 준수
2. `docs/ADR.md`에 정의된 기술 선택 준수
3. 새 기능이나 버그 수정에 대한 테스트 존재
4. `AGENTS.md`의 CRITICAL 규칙 준수
5. 관련 build, typecheck, lint와 test 통과

발견 사항은 심각도순으로 제시한다. 각 항목에는 파일과 위치, 영향, 재현 조건, 최소 수정 방향을 포함한다. 근거 없는 추측은 finding으로 보고하지 않는다. 문제가 없으면 그 사실과 검증하지 못한 영역을 명시한다.

마지막에 다음 표로 요약한다.

| 항목 | 결과 | 비고 |
|------|------|------|
| 아키텍처 준수 | ✅/❌ | 상세 |
| 기술 스택 준수 | ✅/❌ | 상세 |
| 테스트 존재 | ✅/❌ | 상세 |
| CRITICAL 규칙 | ✅/❌ | 상세 |
| 빌드 가능 | ✅/❌ | 상세 |

리뷰 요청만으로 파일을 수정하거나 commit하지 않는다.
