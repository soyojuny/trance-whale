# PRD 검증 근거와 수동 확인 계획

## 범위와 판정 원칙

이 문서는 `docs/PRD.md` 13장 성공 지표와 14장 인수 조건의 현재 검증 근거를 추적한다. 문서 상태는 여전히 `Draft`이며, 이 문서는 릴리스 승인이나 목표 달성을 선언하지 않는다.

- **자동 테스트 근거**는 fixture, 테스트 더블 또는 브라우저 E2E가 요구 동작을 재현한다는 뜻이다. 실제 69shuba 접근이나 실제 Gemini 호출의 성공률을 뜻하지 않는다.
- **수동 검증 필요**는 실제 API Key, 실제 사이트, 설치 환경 또는 사람이 판단하는 품질이 필요한 항목이다.
- **미검증**은 이 저장소에 해당 조건의 자동 근거도 수동 결과도 아직 없는 항목이다.

자동 테스트는 외부 e-book 사이트와 Gemini API를 호출하지 않는다. fixture와 Playwright route mock은 경계와 UI 흐름을 결정적으로 검증하기 위한 것이다.

## 자동 검증 자산

| 검증 영역 | 추적 가능한 근거 | PRD 연관 |
|---|---|---|
| source fixture 계약 | `tests/fixtures/69shuba/chapter.html`, `catalog-*.html`; `tests/unit/shuba69-chapter-extractor.test.ts`, `shuba69-catalog-extractor.test.ts` | FR-02, AC 2·6·7 |
| source API와 보안 경계 | `tests/integration/chapter-source-route.test.ts`, `catalog-source-route.test.ts`; `tests/unit/validate-url.server.test.ts`, `fetch-source.server.test.ts` | FR-01·02, AC 12 |
| 문단 대응과 순차 표시 | `tests/unit/translation-output.test.ts`, `translation-orchestrator.test.ts`, `reader-view.test.tsx`; `tests/integration/client-translation-pipeline.test.ts` | FR-03·06·07, AC 3·4 |
| cache hit/miss 및 무효화 | `tests/integration/cached-translation-pipeline.test.ts`, `client-translation-pipeline.test.ts`; `tests/unit/translation-cache-key.test.ts`, `source-cache.client.test.ts` | FR-08, AC 8·9·13·14 |
| 내부 navigation·목차·읽기 위치 | `tests/integration/reader-navigation.test.tsx`, `tests/unit/catalog-sheet.test.tsx`, `catalog-session.client.test.ts` | FR-06·06-1, AC 6·7 |
| PWA와 저장소 경계 | `tests/unit/pwa-manifest.test.ts`, `service-worker.test.ts`, `tests/integration/local-data-reset.test.ts` | FR-05·08·09, AC 10·11·13 |
| 360px 및 주요 브라우저 흐름 | `tests/e2e/mvp-reader.spec.ts`의 cache 복원·overflow·44px 도구막대·키보드 사례 | NFR 접근성, AC 1·3·5·6·7·8·10·13·14 |

## 인수 조건 추적

| AC | 분류 | 자동 테스트 근거 | 수동 확인 또는 한계 |
|---:|---|---|---|
| 1 | 자동 테스트 근거 + 수동 검증 필요 | E2E가 mock Gemini Key 저장과 지원 URL 진입을 검증한다. | 실제 Google AI Studio Key의 검증과 저장 UX를 사람이 확인한다. |
| 2 | 자동 테스트 근거 + 수동 검증 필요 | 69shuba 장 fixture 추출기가 제목·순서·광고 제외를 계약 검증한다. | 실제 샘플 URL의 최신 HTML에서도 추출되는지 확인한다. |
| 3 | 자동 테스트 근거 + 수동 검증 필요 | 구조화 출력의 ID·순서·빈 값 검증, progressive reader 렌더링, E2E 보기 모드가 있다. | 실제 Gemini 번역문의 한국어 자연스러움은 사람 평가가 필요하다. |
| 4 | 자동 테스트 근거 | Reader unit/E2E가 진행 상태, 안전한 부분 실패 이유, 재시도를 검증한다. | 실제 Gemini 오류 분류의 운영 적합성은 출시 전 점검한다. |
| 5 | 자동 테스트 근거 | Reader unit과 E2E가 번역문·원문·함께 보기 전환을 검증한다. | 없음. |
| 6 | 자동 테스트 근거 | Reader navigation integration과 E2E가 이전·다음·목차의 내부 URL 이동을 검증한다. | 실제 source navigation URL 형식은 사이트 점검이 필요하다. |
| 7 | 자동 테스트 근거 + 수동 검증 필요 | catalog fixture, session/sheet unit, E2E 검색·역순·선택이 있다. | 실제 작품의 전체 페이지 목차와 대량 목록 체감을 확인한다. |
| 8 | 자동 테스트 근거 | cached pipeline, reader session offline recovery, E2E reload가 cache hit에서 Gemini 미호출을 검증한다. | 실제 브라우저 저장소 quota/삭제 정책은 출시 환경에서 점검한다. |
| 9 | 자동 테스트 근거 | cache-key와 client pipeline integration이 원문·프롬프트·모델 변경 cache 분리를 검증한다. | 없음. |
| 10 | 자동 테스트 근거 | preferences unit과 E2E reload가 설정 복원을 검증한다. | 지원 브라우저별 localStorage 제한을 점검한다. |
| 11 | 자동 테스트 근거 | local-data-reset integration이 앱 소유 localStorage·IndexedDB·Cache Storage 삭제를 검증한다. | 실제 브라우저에서 사용자 확인 흐름을 점검한다. |
| 12 | 자동 테스트 근거 | URL/DNS/redirect unit과 source route integration이 미지원·내부 주소 거부를 검증한다. | 배포 egress/DNS 재바인딩 방어는 운영 환경에서 점검한다. |
| 13 | 자동 테스트 근거 + 수동 검증 필요 | manifest/SW unit과 production E2E의 cached 장 offline 재사용을 검증한다. | 실제 홈 화면 설치와 설치 후 핵심 흐름은 대상 브라우저·배포 환경에서 확인한다. |
| 14 | 자동 테스트 근거 + 수동 검증 필요 | 모델 catalog·cache key unit과 E2E 설정 흐름이 모델 분리를 검증한다. | 두 실제 모델의 접근 가능 여부와 UI 안내를 실제 Key로 확인한다. |

## PRD 성공 지표: 기록 방식과 미검증 항목

현재 이 문서는 목표치 달성을 주장하지 않는다. fixture 단위 계약은 특정 저장 HTML에 대한 회귀 방지 근거일 뿐, 운영 성공률의 분모가 아니다. 실제 표본과 결과를 아래 방식으로 기록한 뒤에만 PRD 13장의 달성 여부를 판정한다.

| 지표 | 계산 | 현재 분류 | 필요한 수동 기록 |
|---|---|---|---|
| 본문 추출 성공률 95% 이상 | 성공적으로 제목·최소 본문·navigation을 구조화한 URL 수 / 사전 정의한 지원 URL 표본 수 × 100 | 미검증 | 표본 URL 식별자, 시각, 성공/실패 코드. 원본 HTML 전문은 기록하지 않는다. |
| 번역 완료율 95% 이상 | 모든 문단 ID가 유효한 번역으로 완료된 장 수 / 추출 성공 장 수 × 100 | 미검증 | 장 식별자, 모델 모드, 완료/부분 실패/실패와 안전한 오류 코드. API Key는 기록하지 않는다. |
| 문단 대응 관계 99% 이상 | 정확히 한 번, 원문 순서대로 대응한 번역 문단 수 / 요청 문단 수 × 100 | 자동 계약 근거 + 운영 수치 미검증 | 10개 이상 실제 평가 장의 요청·응답 ID 개수와 대응 결과만 집계한다. 원문·번역 전문은 기록하지 않는다. |
| 이전/다음 이동 성공률 100% | 내부 리더에서 유효한 대상 장을 연 이동 수 / 시도한 이전·다음 이동 수 × 100 | 자동 계약 근거 + 운영 수치 미검증 | 실제 사이트 표본에서 시도·성공 횟수와 실패 코드를 기록한다. |
| 360px 핵심 흐름 | 360px에서 URL 입력→번역→보기 전환→navigation을 가로 overflow 없이 완료 | 자동 E2E 근거 + 수동 검증 필요 | 실제 설치 대상 브라우저·기기, viewport, 결과를 기록한다. |

## 중국어 10개 장 품질 평가표

각 행은 서로 다른 중국어 장 하나를 뜻한다. 평가는 실제 API Key를 가진 평가자가 번역을 읽은 뒤 수행한다. 표에는 Key, 원문 전문, 번역문 전문을 쓰지 않는다. 필요한 경우에는 저작권과 개인정보 정책에 맞는 별도 접근 제한 평가 자료를 사용한다.

| 장 식별자/URL 해시 | 모델 모드 | 자연스러움 (1–5) | 의미 보존 (1–5) | 고유명사 일관성 (1–5) | 평가자 | 평가일 | 관찰 메모(전문 금지) |
|---|---|---:|---:|---:|---|---|---|
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |

각 척도는 1(기대에 크게 못 미침)부터 5(일관되게 우수함)까지다. 항목별 평균은 해당 항목의 유효 점수 합계를 유효 평가 수로 나눈다. 세 항목 각각의 평균이 4.0 이상일 때에만 PRD 품질 목표를 충족한 것으로 기록한다. 누락된 점수, 평가 장이 10개 미만인 경우, 또는 모델/프롬프트가 서로 달라 비교가 불가능한 경우에는 `미검증`으로 남긴다.

## 릴리스 전 수동 검증 종료 조건

1. 외부 사이트와 실제 Gemini API를 자동 테스트에 연결하지 않고, 별도 수동 세션에서 위 표본을 수집한다.
2. 수동 결과는 비밀값·원문 전문·번역문 전문 없이 식별자와 집계값만 남긴다.
3. 배포 환경에서 DNS/egress, CSP·보안 헤더, PWA 설치와 오프라인 흐름을 확인한다.
4. 성공 지표와 인수 조건의 수동 항목이 모두 기록되고 검토 승인된 뒤에만 PRD 상태 변경 또는 배포를 논의한다.
