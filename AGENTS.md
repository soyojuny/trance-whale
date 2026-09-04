# 프로젝트: Trance Whale

## 기술 스택

- Next.js App Router
- TypeScript strict mode
- Tailwind CSS
- Node.js 런타임 Route Handler
- Vitest + Testing Library
- Playwright
- PWA(Web App Manifest + Service Worker)

## 아키텍처 규칙

- CRITICAL: `docs/PRD.md`를 제품 요구사항의 기준으로, `docs/ARCHITECTURE.md`를 기술 설계의 기준으로 사용한다.
- CRITICAL: 외부 e-book HTML 수집은 서버의 Route Handler에서만 수행한다. 브라우저에서 원본 사이트를 직접 fetch하거나 iframe으로 실행하지 않는다.
- CRITICAL: 사용자의 Gemini API Key는 브라우저 밖으로 전송하지 않는다. 앱 서버, 서버 로그, 오류 추적 도구 또는 분석 도구가 키를 수신해서는 안 된다.
- CRITICAL: Gemini 번역 요청은 클라이언트에서 Gemini API로 직접 전송한다.
- CRITICAL: 외부 URL을 가져오기 전에 허용 도메인, 프로토콜, 포트, DNS 결과를 검증하고 리다이렉트마다 동일한 검증을 반복한다.
- CRITICAL: 원본 HTML의 스크립트, 스타일, iframe 또는 이벤트 핸들러를 클라이언트에 전달하거나 실행하지 않는다. 추출한 텍스트와 정규화된 URL만 반환한다.
- CRITICAL: API Key는 번역 캐시, 서비스 워커 캐시, URL, 서버 상태 또는 테스트 스냅샷에 포함하지 않는다.
- Server Component를 기본으로 사용하고, 브라우저 API나 사용자 상호작용이 필요한 부분만 Client Component로 만든다.
- API Route와 서버 전용 모듈에는 `server-only` 경계를 적용한다.
- 브라우저 전용 저장소와 Gemini 클라이언트에는 `client-only` 경계를 적용한다.
- 사이트별 DOM 선택자와 파싱 규칙은 `src/lib/extractors/`의 어댑터 내부에만 둔다.
- 지원 사이트 추가 시 공통 추출 인터페이스를 구현하고 fixture 기반 계약 테스트를 함께 추가한다.
- 외부 경계의 입력과 응답은 런타임 스키마로 검증한다.
- 모델 ID는 중앙 설정에서 관리한다. 컴포넌트나 번역 로직에 문자열을 중복해서 하드코딩하지 않는다.
- 번역 캐시 키에는 정규화 URL, 원문 해시, 모델 ID, 대상 언어, 기본 프롬프트 버전, 사용자 프롬프트 해시를 모두 포함한다.
- localStorage에는 작은 설정만 저장하고, 본문·번역·목차처럼 큰 데이터는 IndexedDB에 저장한다.
- 서비스 워커는 앱 셸과 정적 자산만 캐시한다. `/api/`, Gemini API 요청과 API Key가 포함될 수 있는 요청은 캐시하지 않는다.
- 사용자에게 노출하는 오류는 정의된 오류 코드로 분류하며 원본 예외, 응답 본문 또는 비밀 값을 그대로 표시하지 않는다.
- 접근성 있는 시맨틱 HTML을 우선하며, 상태를 색상만으로 전달하지 않는다.
- 모바일 360px 화면을 기본 기준으로 구현하고 데스크톱으로 확장한다.

## 디렉토리 규칙

- 페이지와 Route Handler는 `src/app/`에 둔다.
- 재사용 UI는 `src/components/`에 둔다.
- 도메인 타입과 런타임 스키마는 `src/types/`에 둔다.
- 순수 유틸리티와 사이트 추출기는 `src/lib/`에 둔다.
- Gemini, IndexedDB 등 외부 시스템 래퍼는 `src/services/`에 둔다.
- 테스트 fixture는 실행 코드와 분리하여 `tests/fixtures/`에 둔다.
- 서버 전용 파일은 `.server.ts`, 브라우저 전용 파일은 `.client.ts` 접미사를 사용한다.

## 개발 프로세스

- CRITICAL: 새 기능과 버그 수정은 실패하는 테스트를 먼저 작성한 뒤 최소 구현으로 통과시킨다.
- 추출기 변경 시 실제 사이트에 의존하는 테스트 대신 저장된 HTML fixture로 본문, 탐색 링크, 목차 계약을 검증한다.
- 실제 네트워크와 실제 Gemini API를 단위·통합 테스트에서 호출하지 않는다.
- 파서와 캐시 키 생성기는 가능한 한 순수 함수로 작성한다.
- 변경 후 관련 단위 테스트, 타입 검사, lint를 실행한다. 사용자 흐름 변경 시 Playwright 테스트도 실행한다.
- 보안 관련 코드(URL 검증, 리다이렉트, HTML 추출, 비밀값 처리)는 정상 사례와 거부 사례를 모두 테스트한다.
- 문서와 구현이 달라지면 같은 변경에서 문서도 갱신한다.
- 커밋 메시지는 conventional commits 형식을 따른다(`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).

## 명령어

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run test:e2e
```

프로젝트가 아직 초기화되지 않아 명령어가 없는 경우, 위 스크립트 이름을 기준으로 `package.json`을 구성한다.
