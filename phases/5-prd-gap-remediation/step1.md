# Step 1: Offline reader recovery

## 읽어야 할 파일

- `AGENTS.md`
- `result.md`의 High: 실제 오프라인에서 저장된 장을 열 수 없음
- `docs/PRD.md`의 7.3절, FR-07부터 FR-09, 인수 조건 8, 13
- `docs/ARCHITECTURE.md`의 8.1절, 10장부터 12장, 14장
- `src/lib/reader/session.client.ts`
- `src/lib/translation/cached-pipeline.client.ts`
- `src/services/source-client.client.ts`, `src/services/source-cache.client.ts`
- `src/services/translation-cache.client.ts`
- `tests/unit/reader-session.client.test.ts`, `tests/integration/cached-translation-pipeline.test.ts`

## 작업

테스트를 먼저 작성하고 reader session이 온라인에서는 검증된 chapter를 source cache에 갱신하고, 실제 오프라인에서는 source API 없이 완성된 cached chapter를 복원하도록 구현한다.

- `SourceClient`는 외부 cache 책임을 갖지 않는다. session 의존성에 source cache와 네트워크 가용성 판정을 명시적으로 주입한다.
- 일반 장 열기에서 네트워크가 없으면 정규화 URL로 source cache를 먼저 찾고, cache hit chapter의 `contentHash`로 기존 translation cache를 조회한다. source·complete translation cache가 모두 있으면 제목, 문단, 번역문, navigation을 렌더링한다.
- cached source만 있고 완성된 번역 cache가 없으면 Gemini를 호출하지 않고 `OFFLINE` 공개 오류로 끝낸다. source cache도 없으면 source API를 호출하지 않고 같은 공개 오류로 끝낸다.
- 온라인에서 source 응답 스키마 검증이 끝난 경우에만 source cache를 갱신한다. cache write 실패는 성공한 온라인 독서를 막지 않는다.
- `forceReload`는 source API 재수집이라는 기존 의미를 유지하고 오프라인에서 cached source를 새로 수집한 것처럼 표시하지 않는다.
- 상태에는 `PublicError` 계약만 보관하며 source URL, 원문, Gemini 요청 또는 API Key를 오류 객체에 추가하지 않는다.

## Acceptance Criteria

```bash
npm run test -- --run tests/unit/reader-session.client.test.ts tests/integration/cached-translation-pipeline.test.ts
npm run typecheck
npm run lint
```

## 검증 절차

1. 온라인 수집 뒤 source cache에 검증된 chapter가 기록되는지 확인한다.
2. `navigator.onLine === false`에 해당하는 주입 조건에서 source client 호출 없이 cached source와 cached translation이 완전한 reader 상태를 만드는지 확인한다.
3. cached source 또는 complete translation이 없는 오프라인 장이 Gemini·source 요청 없이 `OFFLINE`으로 끝나는지 확인한다.
4. source cache write 실패가 온라인 source·translation 흐름을 실패시키지 않는지 확인한다.

## 금지사항

- 오프라인 fallback에서 source Route Handler나 원본 e-book URL을 호출하지 마라. 이유: 신규 source 수집은 네트워크가 필요한 서버 전용 작업이다.
- cached source만으로 신규 Gemini 번역을 시작하지 마라. 이유: Gemini 요청은 네트워크와 사용자의 현재 API Key가 필요하다.
- source client에 IndexedDB 또는 React 상태를 넣지 마라. 이유: source API 경계는 브라우저 저장·reader 상태와 분리되어야 한다.
