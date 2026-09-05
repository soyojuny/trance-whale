# PRD 검증 근거와 수동 확인 계획

## 범위와 판정 원칙

이 문서는 `docs/PRD.md` 13장 성공 지표와 14장 인수 조건의 현재 검증 근거 및 EPUB MVP를 위한 추가 검증 계획을 추적한다. 문서 상태는 여전히 `Draft`이며, 이 문서는 릴리스 승인이나 목표 달성을 선언하지 않는다.

- **자동 테스트 근거**는 fixture, 테스트 더블 또는 브라우저 E2E가 요구 동작을 재현한다는 뜻이다. 실제 69shuba 접근이나 실제 Gemini 호출의 성공률을 뜻하지 않는다.
- **수동 검증 필요**는 실제 API Key, 실제 사이트, 설치 환경 또는 사람이 판단하는 품질이 필요한 항목이다.
- **미검증**은 이 저장소에 해당 조건의 자동 근거도 수동 결과도 아직 없는 항목이다.

자동 테스트는 외부 e-book 사이트와 Gemini API를 호출하지 않는다. EPUB은 저작권 문제가 없는 작은 합성 fixture만 사용하며, 실제 사용자가 선택한 EPUB·원문·번역문은 fixture, 스냅샷 또는 테스트 산출물에 저장하지 않는다.

## 자동 검증 자산

| 검증 영역 | 추적 가능한 근거 | PRD 연관 |
|---|---|---|
| 웹 source fixture 계약 | `tests/fixtures/69shuba/chapter.html`, `catalog-*.html`; `tests/unit/shuba69-chapter-extractor.test.ts`, `shuba69-catalog-extractor.test.ts` | FR-02, AC 14 |
| EPUB fixture 계약(추가 필요) | 합성 2장 텍스트 XHTML EPUB fixture와 EPUB parser unit test: 컨테이너·OPF·spine·navigation·문단·local locator | FR-01, AC 2·3·7 |
| EPUB 거부 사례(추가 필요) | 손상 컨테이너, ZIP 폭탄 한도, XML/XHTML 오류, 빈 장, 잘못된 목차, DRM/이미지 기반 EPUB 오류 test | FR-01·07, AC 5 |
| EPUB 저장소·오프라인 경계(추가 필요) | library migration, quota 부족, archive 자동 삭제 금지, reload/offline re-open, local locator의 서버 API 거부 test | FR-01·08·09, AC 3·9·12·13 |
| 웹 source API와 보안 경계 | `tests/integration/chapter-source-route.test.ts`, `catalog-source-route.test.ts`; `tests/unit/validate-url.server.test.ts`, `fetch-source.server.test.ts` | FR-01-1·02, AC 14 |
| 문단 대응과 순차 표시 | `tests/unit/translation-output.test.ts`, `translation-orchestrator.test.ts`, `reader-view.test.tsx`; `tests/integration/client-translation-pipeline.test.ts` | FR-03·06·07, AC 4·5·6 |
| cache hit/miss 및 무효화 | `tests/integration/cached-translation-pipeline.test.ts`, `client-translation-pipeline.test.ts`; `tests/unit/translation-cache-key.test.ts`, `source-cache.client.test.ts` | FR-08, AC 8·10·16 |
| 웹 내부 navigation·목차·읽기 위치 | `tests/integration/reader-navigation.test.tsx`, `tests/unit/catalog-sheet.test.tsx`, `catalog-session.client.test.ts` | FR-06·06-1, AC 14 |
| PWA와 저장소 경계 | `tests/unit/pwa-manifest.test.ts`, `service-worker.test.ts`, `tests/integration/local-data-reset.test.ts` | FR-05·08·09, AC 11·12·15 |
| 기존 360px 웹 흐름 | `tests/e2e/mvp-reader.spec.ts`의 cache 복원·overflow·44px 도구막대·키보드 사례 | NFR 접근성, EPUB 흐름 추가 필요 |

## 개발·통합 회귀 방지 기준

자동 검증을 많이 실행하는 것만으로 품질이 보장되지는 않는다. 각 변경은 아래 순서로 검증해 불필요한 전체 실행과 UI 회귀를 함께 줄인다.

1. 작업 중에는 변경한 단위·통합 테스트만 실행한다. 실패하면 같은 범위의 원인을 수정한 뒤 다시 실행한다.
2. 논리적으로 묶인 변경이 끝나면 `npm run typecheck`와 `npm run lint`를 한 번 실행한다.
3. phase 또는 사용자 흐름이 끝날 때만 `npm run test`, `npm run build`와 해당 흐름의 `npm run test:e2e`를 실행한다. 이미 통과한 전체 검증을 변경 없이 반복하지 않는다.
4. UI를 수정한 경우에는 기준 구현과 비교해 360px 및 데스크톱에서 홈, 리더 탐색, 목차, 설정을 확인한다. 특히 아이콘/라벨, 터치 영역, 시트의 focus·닫기 동작, 모델 선택과 API Key 입력 상태를 확인한다.
5. UI의 의도된 변화는 변경 설명과 함께 기록한다. 의도하지 않은 시각·상호작용 차이는 통합 전에 수정하며, API Key·원문·번역문은 스크린샷·테스트 산출물에 포함하지 않는다.

이 절차는 실제 외부 사이트나 Gemini API를 호출하지 않는다. 브라우저 확인이 필요한 경우에도 합성 fixture와 로컬 설정만 사용한다.

### EPUB UI 연결 확인 (2026-09-05)

- 홈의 기본 입력을 접근성 있는 EPUB 파일 선택으로 전환하고, 웹 URL 입력은 `웹 페이지 가져오기` disclosure 안에 유지했다. 선택 파일명·원문·API Key는 URL과 화면 상태에 표시하지 않는다.
- `tests/unit/home-settings-flow.test.tsx`, `tests/integration/reader-navigation.test.tsx`, `tests/unit/catalog-sheet.test.tsx`는 20개 테스트를 통과했고, `npm run typecheck`와 `npm run lint`도 통과했다.
- Playwright 실행은 이 환경의 Next.js web server가 포트를 열 수 없어 시작하지 못했다(`Operation not permitted`). 이번 EPUB archive 재열기 변경 후에도 같은 오류로 재실행이 중단됐다. 따라서 360px·데스크톱의 브라우저 시각 확인은 포트 바인딩이 가능한 환경에서 다시 실행한다.
- EPUB archive 재열기 단위 검증은 archive·목차·장 경로만 저장하고 source cache에 EPUB 원문 장을 남기지 않으며, 저장 archive에서 요청 장을 다시 추출하는 것을 확인한다. E2E도 EPUB 원문 source cache가 비어 있는지를 확인한다.

## 인수 조건 추적

| AC | 분류 | 자동 테스트 근거 | 수동 확인 또는 한계 |
|---:|---|---|---|
| 1 | 일부 자동 테스트 근거 + 추가 필요 | Gemini Key 설정 E2E는 존재한다. EPUB 파일 선택 UI test와 E2E를 추가한다. | 실제 Google AI Studio Key와 파일 선택 UX를 사람이 확인한다. |
| 2 | 추가 필요 | 합성 2장 EPUB fixture로 제목·본문·spine·목차 추출 및 raw HTML 비렌더링을 계약 검증한다. | 실제 사용자가 합법적으로 보유한 텍스트 EPUB을 수동 선택한다. |
| 3 | 추가 필요 | 네트워크 mock, IndexedDB test, source route integration으로 서버 미전송과 local locator 거부를 검증한다. | 배포 환경 네트워크 패널과 서버 로그를 확인한다. |
| 4 | 자동 테스트 근거 + 수동 검증 필요 | 구조화 출력·순차 렌더링 test가 있다. | 실제 Gemini 번역문의 한국어 자연스러움은 사람 평가가 필요하다. |
| 5 | 일부 자동 테스트 근거 + 추가 필요 | Reader 진행·부분 실패 test가 있다. EPUB 형식·quota 오류 UI test를 추가한다. | 실제 브라우저 quota 동작을 점검한다. |
| 6 | 자동 테스트 근거 | Reader unit과 E2E가 번역문·원문·함께 보기 전환을 검증한다. | 없음. |
| 7 | 추가 필요 | local locator 기반 이전·다음·목차 reader session integration 및 E2E를 추가한다. | 360px 기기에서 목차 조작을 확인한다. |
| 8 | 일부 자동 테스트 근거 + 추가 필요 | translation cache hit test가 있다. EPUB 장 reload에서 Gemini 미호출 test를 추가한다. | 없음. |
| 9 | 추가 필요 | archive 저장, 새로고침 및 offline re-open E2E를 추가한다. | 설치된 PWA에서 수동 확인한다. |
| 10 | 자동 테스트 근거 | cache-key와 client pipeline integration이 원문·프롬프트·모델 변경 cache 분리를 검증한다. | 없음. |
| 11 | 자동 테스트 근거 | preferences unit과 E2E reload가 설정 복원을 검증한다. | 지원 브라우저별 localStorage 제한을 점검한다. |
| 12 | 일부 자동 테스트 근거 + 추가 필요 | local data reset test가 있다. EPUB archive·book metadata deletion assertions를 추가한다. | 실제 브라우저의 삭제 확인 흐름을 점검한다. |
| 13 | 추가 필요 | quota mock에서 cache만 LRU 정리하고 archive를 보존하는 integration test를 추가한다. | 실제 저장공간 부족 환경에서 확인한다. |
| 14 | 자동 테스트 근거 + 수동 검증 필요 | URL/DNS/redirect 및 source route test가 있다. | 배포 egress/DNS 재바인딩 방어와 69shuba 보조 경로를 점검한다. |
| 15 | 일부 자동 테스트 근거 + 추가 필요 | manifest/SW test는 존재한다. EPUB import·offline E2E를 추가한다. | 실제 홈 화면 설치 후 핵심 흐름을 확인한다. |
| 16 | 자동 테스트 근거 + 수동 검증 필요 | 모델 catalog·cache key unit과 E2E 설정 흐름이 모델 분리를 검증한다. | 두 실제 모델의 접근 가능 여부와 UI 안내를 실제 Key로 확인한다. |

## PRD 성공 지표: 기록 방식과 미검증 항목

현재 이 문서는 목표치 달성을 주장하지 않는다. fixture 단위 계약은 특정 저장 HTML에 대한 회귀 방지 근거일 뿐, 운영 성공률의 분모가 아니다. 실제 표본과 결과를 아래 방식으로 기록한 뒤에만 PRD 13장의 달성 여부를 판정한다.

| 지표 | 계산 | 현재 분류 | 필요한 수동 기록 |
|---|---|---|---|
| 합성 EPUB 장·목차 추출 성공률 100% | 정상 fixture에서 추출한 장·목차 수 / fixture에 정의한 장·목차 수 × 100 | 추가 필요 | 합성 fixture ID와 parser 결과만 기록한다. 실제 사용자 EPUB은 기록하지 않는다. |
| 웹페이지 본문 추출 성공률 95% 이상(보조) | 성공적으로 제목·최소 본문·navigation을 구조화한 URL 수 / 사전 정의한 지원 URL 표본 수 × 100 | 미검증 | 표본 URL 식별자, 시각, 성공/실패 코드. 원본 HTML 전문은 기록하지 않는다. |
| 번역 완료율 95% 이상 | 모든 문단 ID가 유효한 번역으로 완료된 EPUB 또는 웹 장 수 / 성공적으로 추출한 장 수 × 100 | 미검증 | 장 식별자 또는 local locator 해시, 모델 모드, 완료/부분 실패/실패와 안전한 오류 코드. API Key와 본문은 기록하지 않는다. |
| 문단 대응 관계 99% 이상 | 정확히 한 번, 원문 순서대로 대응한 번역 문단 수 / 요청 문단 수 × 100 | 자동 계약 근거 + 운영 수치 미검증 | 10개 이상 실제 평가 장의 요청·응답 ID 개수와 대응 결과만 집계한다. 원문·번역 전문은 기록하지 않는다. |
| 이전/다음 이동 성공률 100% | 내부 리더에서 유효한 대상 장을 연 이동 수 / 시도한 이전·다음 이동 수 × 100 | EPUB 추가 필요 + 웹 자동 계약 근거 | 합성 EPUB 및 실제 사이트 표본별 시도·성공 횟수와 실패 코드를 기록한다. |
| 360px 핵심 흐름 | 360px에서 EPUB 선택→번역→보기 전환→목차/장 navigation을 가로 overflow 없이 완료 | EPUB E2E 추가 필요 | 실제 설치 대상 브라우저·기기, viewport, 결과를 기록한다. |

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

1. 외부 사이트와 실제 Gemini API를 자동 테스트에 연결하지 않고, 저작권 문제가 없는 합성 EPUB fixture와 별도 수동 세션을 사용한다.
2. 수동 결과는 비밀값·EPUB 파일명·원문 전문·번역문 전문 없이 식별자 해시와 집계값만 남긴다.
3. 배포 환경에서 DNS/egress, CSP·보안 헤더, PWA 설치, EPUB archive의 로컬 보관과 오프라인 흐름을 확인한다.
4. 성공 지표와 인수 조건의 수동 항목이 모두 기록되고 검토 승인된 뒤에만 PRD 상태 변경 또는 배포를 논의한다.
