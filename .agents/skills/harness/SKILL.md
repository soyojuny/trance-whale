---
name: harness
description: Harness phase를 탐색하고 독립 실행 가능한 step으로 설계하거나, phase 파일을 생성하고 scripts/execute.py로 실행할 때 사용한다.
---

# Harness Workflow

## 탐색

`AGENTS.md`와 step에 필요한 `docs/` 아래 문서만 먼저 읽고 제품·아키텍처·설계 의도를 파악한다. 전체 문서 감사가 아닌 이상 모든 문서를 다시 읽지 않는다. 기존 `phases/`가 있으면 현재 상태와 선행 산출물도 확인한다.

## 논의와 승인

구현 결과를 크게 바꾸는 결정이 남아 있으면 사용자와 논의한다. 사용자가 계획 작성을 요청하면 step 초안을 먼저 제시하고, phase 파일은 사용자가 승인한 뒤 생성한다.

## Step 설계 원칙

1. 한 step은 하나의 레이어나 모듈만 다룬다.
2. 각 step 파일은 독립된 Codex session에서도 이해할 수 있도록 자기완결적으로 작성한다.
3. 관련 문서와 이전 step에서 생성하거나 수정한 파일 경로를 명시한다.
4. 함수와 클래스의 interface 및 핵심 불변 조건은 명확히 쓰되 내부 구현은 실행 agent에 맡긴다.
5. Acceptance Criteria는 실제 실행 가능한 명령으로 작성한다.
6. 금지사항은 `X를 하지 마라. 이유: Y` 형식으로 구체화한다.
7. step 이름은 kebab-case slug를 사용한다.
8. `읽어야 할 파일`에는 실제로 필요한 문서와 코드 경로만 적는다. 문서는 정확한 경로와 필요한 절을 적고, 실행기는 이 목록의 `docs/*.md`만 주입한다.
9. UI를 변경하는 step은 `docs/UI_GUIDE.md`와 보호할 화면·viewport·상호작용을 명시한다. 승인된 UI의 의도 없는 변경은 허용하지 않는다.

## 실행 예산과 검증

1. phase 시작 전 step에 필요한 `node`, `npm`, `npx`, E2E 브라우저를 한 번 점검한다. 누락된 의존성이나 인증은 즉시 `blocked`로 기록하고 같은 실패를 재시도하지 않는다.
2. 탐색은 필요한 파일과 코드 범위만 읽고, 긴 파일 전문·전체 파일 목록·이미 본 출력을 반복하지 않는다. 도구 출력은 필요한 범위로 제한한다.
3. 장시간 명령은 예상 완료 시점에 한 번 확인한다. 상태 변화가 없는 빈 폴링을 연속으로 실행하지 않는다.
4. step 중에는 변경 영역의 테스트를 우선 실행한다. `typecheck`와 `lint`는 논리적 변경 묶음 완료 시 한 번, 전체 `test`·`build`·E2E는 phase 마지막 통합 step에서 한 번 실행한다.
5. UI 통합 step은 360px과 데스크톱에서 `docs/VALIDATION.md`의 UI 회귀 방지 기준을 확인한다. 테스트 산출물에는 API Key, 원문 또는 번역문을 남기지 않는다.

## Phase 파일

`phases/index.json`에는 task directory와 초기 `pending` status를 추가한다. 기존 파일이 있으면 다른 항목을 보존한다.

`phases/{task-name}/index.json`은 `project`, `phase`, `steps`를 포함한다. step 번호는 0부터 시작하고 초기 status는 `pending`으로 둔다. 실행기가 관리하는 timestamp는 생성 시 넣지 않는다.

각 `step{N}.md`에는 다음 section을 둔다.

- 읽어야 할 파일
- 작업
- Acceptance Criteria
- 검증 절차
- 금지사항

완료한 step에는 `status: completed`와 다음 step에 유용한 한 줄 `summary`를 기록한다. 수정 시도 후 실패하면 `error_message`, 사용자 개입이 필요하면 `blocked_reason`을 기록한다.

## 실행

```bash
python3 scripts/execute.py {task-name}
python3 scripts/execute.py {task-name} --push
```

실행기는 branch 생성, `AGENTS.md`와 step이 명시한 문서 규칙 주입, summary 누적, 최대 3회 재시도, step별 commit과 timestamp 기록을 담당한다. `error` 또는 `blocked` 상태를 복구할 때는 원인을 해결한 뒤 status를 `pending`으로 되돌리고 관련 오류 필드를 제거한다.
