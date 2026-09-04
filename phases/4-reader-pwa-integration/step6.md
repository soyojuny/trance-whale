# Step 6: PWA shell and offline

## 읽어야 할 파일

- `AGENTS.md`
- `docs/PRD.md`의 FR-08, FR-09, 보안·호환성 요구사항과 인수 조건 11, 13
- `docs/ARCHITECTURE.md`의 11장부터 13장, 17장
- `src/app/layout.tsx`
- `src/app/globals.css`
- `src/services/local-data.client.ts`
- `src/services/translation-cache.client.ts`
- `next.config.*`
- `package.json`

## 작업

테스트를 먼저 작성하고 설치 가능한 Web App Manifest, 앱 아이콘, Service Worker와 등록 경계를 구현한다.

- App Router metadata 또는 `src/app/manifest.ts`에 이름, 짧은 이름, 시작 URL, `standalone`, theme/background color와 필요한 아이콘 정보를 정의한다.
- 프로젝트 디자인 토큰에 맞는 최소 PWA 아이콘 자산을 저장소 안에 추가하고 manifest 경로 및 크기와 일치시킨다.
- Service Worker cache 이름은 Phase 3 local data reset이 사용하는 앱 소유 prefix와 명시적으로 공유하고 빌드 식별자가 포함된 버전으로 관리한다.
- install 단계에서는 앱 셸과 동일 origin 정적 자산만 precache하고 activate 단계에서는 동일 prefix의 이전 버전 cache만 정리한다.
- fetch handler는 `GET`의 동일 origin navigation 및 정적 자산에만 제한하고 `/api/`, Gemini origin, 외부 e-book origin, non-GET 요청과 민감 header가 있는 요청은 읽거나 cache하지 않고 그대로 network로 전달한다.
- offline navigation은 앱 셸을 제공하되 신규 source 또는 번역 요청은 `OFFLINE` 공개 상태가 되며, cached translation hit는 Gemini나 source 요청 없이 계속 표시한다.
- Service Worker 등록은 작은 Client Component로 격리하고 새 worker가 준비되어도 열린 reader를 자동 reload하거나 즉시 `skipWaiting`하지 않는다.
- Next.js 응답에 CSP, HSTS, `Referrer-Policy`, `X-Content-Type-Options` 등 보안 헤더를 설정하며 CSP `connect-src`는 same origin과 Gemini API origin만 허용한다.
- unit test에서는 Service Worker 이벤트와 Cache Storage를 test double로 검증하고 실제 네트워크를 호출하지 않는다.

## Acceptance Criteria

- `npm run test -- --run tests/unit/service-worker.test.ts tests/unit/pwa-manifest.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 검증 절차

1. production build가 유효한 manifest, 아이콘, standalone metadata와 Service Worker 자산을 생성하는지 확인한다.
2. 앱 셸과 정적 자산만 저장되고 `/api/`, Gemini, 외부 origin, non-GET 및 민감 요청이 Cache Storage에 기록되지 않는지 확인한다.
3. 새 버전 activate가 앱 prefix의 과거 cache만 제거하고 다른 origin cache 이름은 보존하는지 확인한다.
4. 오프라인 cache hit 장은 읽을 수 있고 신규 장·목차·번역은 네트워크 필요 오류를 표시하는지 확인한다.
5. 업데이트 준비가 열린 독서 화면을 reload하지 않고 사용자 흐름을 유지하는지 확인한다.
6. 보안 헤더와 CSP가 외부 원본 콘텐츠 및 불필요한 제3자 연결을 허용하지 않는지 확인한다.

## 금지사항

- `/api/`, Gemini 요청 또는 외부 e-book 응답을 캐시하지 마라. 이유: 네트워크 최신성, 비밀값과 저작물 경계를 위반할 수 있다.
- 요청 header, body 또는 URL에서 API Key를 읽거나 cache key로 사용하지 마라. 이유: Service Worker 저장소에 비밀값이 남아서는 안 된다.
- 모든 origin cache를 삭제하지 마라. 이유: 앱이 소유하지 않은 Cache Storage를 훼손할 수 있다.
- 설치 즉시 강제 reload하거나 무조건 `skipWaiting`하지 마라. 이유: 진행 중인 독서와 번역을 중단시킬 수 있다.
- 오프라인에서 미저장 장이나 신규 번역이 가능하다고 표시하지 마라. 이유: source 수집과 Gemini 번역은 네트워크가 필요하다.
