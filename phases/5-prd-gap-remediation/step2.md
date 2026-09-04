# Step 2: Selective failed chunk retry

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 Medium: 실패한 chunk만 재시도하지 않고 전체 장을 재번역함
- `docs/PRD.md`의 FR-03, FR-07, FR-08
- `docs/ARCHITECTURE.md`의 6.2절, 9장, 14장
- `src/types/translation.ts`
- `src/lib/translation/chunk.ts`, `src/lib/translation/orchestrator.client.ts`
- `src/lib/translation/pipeline.client.ts`, `src/lib/translation/cached-pipeline.client.ts`
- `src/services/translation-cache.client.ts`
- `tests/unit/translation-orchestrator.test.ts`, `tests/integration/cached-translation-pipeline.test.ts`

## 작업

테스트를 먼저 작성하고 cached translation pipeline에 실패 chunk만 재실행하는 명시적 재시도 입력을 추가한다.

- prepared translation 실행 인터페이스는 전체 강제 재번역과 부분 실패 재시도를 구별해야 한다. 부분 재시도 입력은 검증된 `failedChunkIds`와 기존 성공 `TranslationParagraph[]`만 받는다.
- 부분 재시도는 해당 chunk만 Gemini에 보내고, 기존 성공 문단을 처음 progress부터 유지하며 ID 기준으로 결과를 병합한다. 원문 문단 순서와 ID의 완전성·유일성은 기존 출력 계약으로 다시 검증한다.
- 부분 재시도 후에도 실패하면 기존 성공 번역과 새 실패 chunk ID를 보존한다. 완전한 문단 집합이 만들어졌을 때만 translation cache를 저장한다.
- `forceRetranslate`는 사용자가 현재 장 전체를 의도적으로 다시 번역하는 기존 의미를 유지한다. cache miss·hit와 부분 재시도 결정을 섞지 않는다.
- invalid 또는 중복 chunk ID, 실패 chunk가 아닌 문단의 변경, 불완전한 병합은 안전한 translation 실패로 처리한다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/translation-orchestrator.test.ts tests/integration/cached-translation-pipeline.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 여러 chunk 중 하나가 실패한 뒤 재시도하면 Gemini test double이 그 chunk만 받는지 확인한다.
2. 재시도 중과 재시도 실패 뒤에도 기존 성공 문단이 progress와 최종 결과에 유지되는지 확인한다.
3. 부분 재시도 완료 전에는 cache write가 없고, 전체 문단이 완성된 뒤에만 병합 결과가 저장되는지 확인한다.
4. 전체 강제 재번역은 이전과 같이 모든 chunk를 대상으로 하는지 확인한다.

## 금지사항

- 부분 실패 재시도에 `forceRetranslate: true`만 재사용하지 마라. 이유: 이미 성공한 문단까지 재전송해 API 할당량과 비용을 낭비한다.
- 성공 문단을 위치 기반 배열 병합으로 덮어쓰지 마라. 이유: 문단 ID는 누락·순서 변경을 검출하는 번역 계약이다.
- 완성되지 않은 결과를 translation cache에 저장하지 마라. 이유: 재방문 시 누락된 번역을 정상 cache hit로 잘못 표시할 수 있다.
