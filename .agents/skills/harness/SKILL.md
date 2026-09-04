---
name: harness
description: Harness phase를 탐색하고 독립 실행 가능한 step으로 설계하거나, phase 파일을 생성하고 scripts/execute.py로 실행할 때 사용한다.
---

# Harness Workflow

## 탐색

`AGENTS.md`와 `docs/` 아래 관련 문서를 먼저 읽고 제품·아키텍처·설계 의도를 파악한다. 기존 `phases/`가 있으면 현재 상태와 선행 산출물도 확인한다.

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

실행기는 branch 생성, `AGENTS.md`와 문서 규칙 주입, summary 누적, 최대 3회 재시도, step별 commit과 timestamp 기록을 담당한다. `error` 또는 `blocked` 상태를 복구할 때는 원인을 해결한 뒤 status를 `pending`으로 되돌리고 관련 오류 필드를 제거한다.
