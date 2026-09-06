# 아키텍처

## 1. 목적

Trance Whale은 사용자가 선택한 EPUB을 브라우저에서 안전하게 읽어 구조화하고, 사용자의 Google AI Studio API Key로 Gemini 번역을 수행하는 PWA다. 서버 기반 웹소설 페이지 수집은 보조 경로로 유지한다.

이 문서는 다음 경계를 정의한다.

- 앱 서버: 보조 웹페이지 경로의 외부 URL 검증, HTML 수집, 사이트별 본문 및 목차 추출
- 브라우저: EPUB 해제·파싱, 사용자 설정, Gemini 번역, 리더 UI, 로컬 저장소
- 외부 시스템: 지원 e-book 사이트와 Gemini API

제품 범위와 인수 조건은 `docs/PRD.md`를 따른다.

## 2. 기술 스택

- 프레임워크: Next.js App Router
- 언어: TypeScript strict mode
- UI: React, Tailwind CSS
- 서버 HTML 파싱: Cheerio 계열의 정적 HTML 파서
- 런타임 검증: Zod 계열 스키마 검증기
- 로컬 데이터: localStorage, IndexedDB
- PWA: Web App Manifest, Service Worker
- 단위·통합 테스트: Vitest, Testing Library
- E2E 테스트: Playwright

정확한 패키지와 버전은 프로젝트 초기화 시 고정한다. 라이브러리 교체가 아래 시스템 경계를 변경해서는 안 된다.

## 3. 핵심 설계 결정

### 3.1 원본 사이트를 프록시 화면으로 제공하지 않는다

외부 사이트는 iframe이나 DOM 복제 방식으로 표시하지 않는다. 서버는 HTML을 텍스트 데이터로만 해석하고 다음 구조만 클라이언트에 반환한다.

- 작품 및 장 제목
- 장 번호(추출 가능한 경우)
- 본문 문단
- 이전 장, 다음 장, 목차의 정규화 URL
- 목차 장 목록

이를 통해 동일 출처 정책 문제를 피하고, 원본 스크립트·광고·추적 코드가 앱에서 실행되지 않게 한다.

### 3.2 EPUB은 브라우저에서만 처리한다

사용자가 파일 선택기로 고른 `.epub`만 브라우저 전용 파서가 처리한다. 원본 압축 Blob, 추출한 장 원문, 번역 및 API Key는 서버로 보내지 않는다. 파서는 컨테이너·OPF·spine·navigation을 검증한 뒤 XHTML의 제목과 텍스트 문단만 정규화하며, archive의 HTML·스타일·이미지·스크립트·iframe·이벤트 핸들러는 저장하거나 렌더링하지 않는다.

로컬 장의 canonical locator는 `local-epub://book/{bookId}/chapter/{index}`다. 이는 앱 내부 식별자일 뿐 URL 수집 API 또는 외부 fetch에 전달할 수 없다.

### 3.3 HTML 수집과 번역의 책임을 분리한다

- 앱 서버는 원본 HTML을 수집하고 구조화한다.
- 브라우저는 사용자의 API Key로 Gemini API를 직접 호출한다.
- 앱 서버는 API Key, 프롬프트, 번역 요청 또는 번역 결과를 중계하거나 저장하지 않는다.

이 구조는 DB 없는 BYOK(Bring Your Own Key) 제품 요구사항에 맞고, 사용자의 키가 앱 인프라에 남는 것을 방지한다.

### 3.4 사이트별 추출 어댑터를 사용한다

범용 가독성 알고리즘에만 의존하지 않고 지원 사이트마다 명시적인 추출기를 둔다. MVP에는 `www.69shuba.com` 어댑터를 제공한다.

각 어댑터는 다음 계약을 구현한다.

```ts
interface SiteExtractor {
  readonly id: string;
  readonly hosts: readonly string[];
  matches(url: URL): boolean;
  normalizeUrl(url: URL): URL;
  extractChapter(html: string, sourceUrl: URL): ChapterSource;
  extractCatalog(html: string, sourceUrl: URL): CatalogSource;
}
```

CSS 선택자, 문자 인코딩 보정, 광고 제거 규칙과 URL 패턴은 해당 어댑터 안에만 둔다.

### 3.5 번역 결과와 EPUB은 브라우저에 저장한다

번역문과 목차는 IndexedDB에 저장한다. 동일 콘텐츠를 다시 열 때 API를 재호출하지 않아 속도와 무료 할당량을 절약한다.

- localStorage: API Key, 프롬프트, 선택 모델, 리더 설정, 마지막 읽기 위치
- IndexedDB: EPUB 책 메타데이터·archive Blob, 원문 메타데이터, 번역 결과, 목차, 접근 시각
- Service Worker Cache Storage: 앱 셸과 정적 자산만 저장

배포 식별자와 같은 비공개 환경변수는 `server-only`를 선언한 `.server.*` 모듈에서만 계산한다. 브라우저와 공유하는 캐시 접두사 등은 환경변수를 읽지 않는 순수 상수 모듈로 분리한다.

세 저장소의 책임을 섞지 않는다.

## 4. 시스템 구성

```text
┌──────────────────────────── Browser / PWA ────────────────────────────┐
│ EPUB 선택 → 브라우저 전용 파서 → 리더 상태 → Gemini Developer API    │
│                    │                 │                    ▲            │
│                    └─ IndexedDB(archive·장·번역) ──────┘              │
│ URL 입력(보조) ─────────────────────┬─ localStorage(키·설정·읽기 위치) │
└────────────────────────────────────┬──────────────────────────────────┘
                                     │ 웹페이지 보조 요청/응답(API Key 없음)
┌───────────────────────────────▼───────────────────────────────────────┐
│ Next.js Route Handler                                               │
│ 요청 검증 → URL 보안 검증 → 안전한 fetch → 사이트 어댑터 → 스키마 검증 │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS GET(쿠키·인증 없음)
                    ┌───────────▼───────────┐
                    │ 지원 e-book 사이트   │
                    └───────────────────────┘
```

## 5. 디렉토리 구조

```text
src/
├── app/
│   ├── api/
│   │   └── source/
│   │       ├── chapter/route.ts       # 장 수집 및 추출
│   │       └── catalog/route.ts       # 전체 목차 수집 및 추출
│   ├── read/page.tsx                   # 리더 진입점
│   ├── catalog/page.tsx                # 앱 내부 목차
│   ├── settings/page.tsx               # API Key, 모델, 프롬프트, 저장소
│   ├── layout.tsx
│   ├── page.tsx                        # EPUB 선택, 웹 URL 보조 입력 및 이어 읽기
│   └── manifest.ts
├── components/
│   ├── reader/                         # 본문, 진행률, 장 탐색
│   ├── catalog/                        # 검색, 정렬, 가상 목록
│   ├── settings/                       # API Key와 번역 설정
│   └── ui/                             # 공용 UI
├── lib/
│   ├── extractors/
│   │   ├── extractor.ts               # 공통 계약과 레지스트리
│   │   └── shuba69.server.ts           # 69shuba 전용 어댑터
│   ├── source/
│   │   ├── fetch-source.server.ts      # 제한된 외부 fetch
│   │   └── validate-url.server.ts      # SSRF 방어
│   ├── epub/
│   │   ├── parse-epub.client.ts        # 컨테이너·OPF·XHTML 브라우저 파서
│   │   └── locator.client.ts           # local-epub locator 생성·검증
│   ├── translation/
│   │   ├── chunk.ts                    # 문단 단위 요청 묶음
│   │   ├── cache-key.client.ts         # 캐시 키 생성
│   │   └── prompt.ts                   # 기본 프롬프트와 버전
│   └── errors.ts                       # 오류 코드와 안전한 매핑
├── services/
│   ├── gemini.client.ts                # 브라우저 전용 Gemini 래퍼
│   ├── reader-db.client.ts             # IndexedDB 접근
│   ├── local-epub-library.client.ts    # EPUB archive·메타데이터 저장소
│   └── preferences.client.ts           # localStorage 접근
└── types/
    ├── source.ts                       # ChapterSource, CatalogSource
    ├── translation.ts                  # 번역 요청/결과
    └── storage.ts                      # 로컬 저장 레코드

tests/
├── fixtures/
│   └── 69shuba/                        # 저장한 장·목차 HTML
├── unit/
├── integration/
└── e2e/
```

## 6. 도메인 모델

### 6.1 추출 결과

```ts
type LocalEpubLocator = `local-epub://book/${string}/chapter/${number}`;

type NavigationTarget = {
  url: string;
  label?: string;
};

type LocalEpubBook = {
  id: string; // EPUB 파일 바이트의 SHA-256
  title: string;
  author?: string;
  language?: string;
  sourceByteSize: number;
  importedAt: string;
  chapters: Array<{
    index: number;
    canonicalUrl: LocalEpubLocator;
    title: string;
  }>;
};

type ChapterSource = {
  kind: "chapter";
  sourceUrl: string;
  canonicalUrl: string;
  siteId: string;
  bookId?: string;
  bookTitle?: string;
  chapterId?: string;
  chapterNumber?: number;
  chapterTitle: string;
  paragraphs: Array<{ id: string; text: string }>;
  navigation: {
    previous?: NavigationTarget;
    catalog?: NavigationTarget;
    next?: NavigationTarget;
  };
  contentHash: string;
  fetchedAt: string;
};

type CatalogSource = {
  kind: "catalog";
  sourceUrl: string;
  canonicalUrl: string;
  siteId: string;
  bookId?: string;
  bookTitle: string;
  chapters: Array<{
    id: string;
    url: string;
    title: string;
    number?: number;
    sourceIndex: number;
  }>;
  fetchedAt: string;
};
```

문단 ID는 한 장 안에서 안정적인 순서를 표현해야 한다. Gemini 응답과 원문 문단을 위치가 아닌 ID로 대응시켜 누락과 순서 변경을 검출한다.

EPUB 장은 기존 `ChapterSource` 모양으로 정규화한다. `sourceUrl`과 `canonicalUrl`에는 `LocalEpubLocator`, `siteId`에는 로컬 EPUB 식별값을 사용하고, `navigation.previous`·`next`는 같은 책의 인접 장만 가리킨다. EPUB 목차는 같은 책의 로컬 `CatalogSource`로 제공한다.

### 6.2 번역 캐시

```ts
type TranslationCacheRecord = {
  cacheKey: string;
  canonicalUrl: string;
  contentHash: string;
  modelId: string;
  targetLanguage: "ko";
  basePromptVersion: string;
  userPromptHash: string;
  translatedParagraphs: Array<{ id: string; text: string }>;
  createdAt: string;
  accessedAt: string;
  byteSize: number;
};
```

캐시 키의 원재료를 `SHA-256`으로 직렬화하여 고정 길이 키를 만든다. 사용자 프롬프트 원문과 API Key 자체는 캐시 키나 레코드에 저장하지 않는다.

## 7. API 경계

### 7.1 `POST /api/source/chapter`

요청:

```json
{ "url": "https://www.69shuba.com/txt/48273/32028706" }
```

응답은 `ChapterSource`다. API Key, 사용자 프롬프트와 번역 관련 값은 받지 않는다.

### 7.2 `POST /api/source/catalog`

요청:

```json
{ "url": "https://www.69shuba.com/book/48273/" }
```

응답은 `CatalogSource`다. 목차가 페이지네이션된 사이트에서는 서버가 제한된 범위 안에서 후속 페이지를 가져와 하나의 목록으로 병합한다.

### 7.3 공통 API 규칙

- 요청 본문 크기를 제한한다.
- 서버 요청 스키마는 HTTP(S) URL만 허용하며 `local-epub://`을 포함한 앱 내부 locator는 거부한다.
- 응답은 명시적인 성공 타입 또는 공개 오류 타입을 사용한다.
- 원본 HTML과 upstream 응답 본문을 클라이언트에 그대로 반환하지 않는다.
- Route Handler는 Node.js 런타임에서 실행한다. DNS 및 IP 검증이 필요한 수집 코드를 Edge 런타임에 배치하지 않는다.
- 성공 응답에는 `Cache-Control: no-store`를 기본으로 사용한다. 서버 공유 캐시는 MVP 범위가 아니다.

## 8. 데이터 흐름

### 8.1 로컬 EPUB 가져오기와 장 열기

```text
사용자 파일 선택
  → archive 중앙 디렉터리·크기 한도 검사
  → mimetype / container.xml / OPF / spine / navigation 검증
  → XHTML 구조를 검증하고 목차·장 경로를 구성
  → storage estimate 및 persist 요청
  → IndexedDB에 book metadata + archive bytes + 목차 + 장 경로만 저장
  → /read?book={bookId}&chapter={index}
  → 장을 열 때 archive에서 해당 XHTML만 추출하고 content hash 계산
  → 번역 캐시 키 계산
  ├─ cache hit  → IndexedDB 번역문 표시
  └─ cache miss → 본문 분할 → Gemini 요청 → 묶음별 검증/표시/저장
```

이 경로는 앱 서버, `/api/**` 또는 원본 웹사이트에 요청하지 않는다. archive의 압축 해제 전과 후 모두 설정된 크기·항목·장·문단 한도를 적용한다.

### 8.2 웹페이지 보조 경로의 장 열기

```text
사용자 URL 입력
  → 클라이언트 URL 형식 검사
  → POST /api/source/chapter
  → 서버 URL/호스트/DNS 검증
  → 원본 HTML fetch
  → 사이트 어댑터로 ChapterSource 추출
  → 응답 스키마 검증
  → 브라우저에서 번역 캐시 키 계산
  ├─ cache hit  → IndexedDB 번역문 표시
  └─ cache miss → 본문 분할 → Gemini 요청 → 묶음별 검증/표시/저장
```

### 8.3 이전 장과 다음 장

탐색 버튼은 원본 링크로 브라우저를 이동시키지 않는다. 웹페이지는 대상 URL을 앱의 `/read?url=...` 상태로 전달하고 보조 장 열기 흐름을 반복한다. EPUB은 `/read?book=...&chapter=...` 상태로 같은 책의 저장된 인접 장을 source client fetch 없이 연다.

### 8.4 목차

```text
ChapterSource.navigation.catalog
  → IndexedDB에서 24시간 이내 목차 조회
  ├─ cache hit  → 즉시 목록 표시
  └─ cache miss → POST /api/source/catalog → 추출 → IndexedDB 저장
  → 원문 장 제목/장 번호 검색 및 정렬
  → 선택한 URL을 앱 리더에서 열기
```

EPUB은 저장된 로컬 목차를 우선 사용하고, 목차가 없으면 spine 순서만 제공한다. 2,000개 이상의 항목도 DOM에 모두 렌더링하지 않도록 가상 목록을 사용한다. 목차 제목은 MVP에서 번역하지 않는다.

## 9. 번역 설계

### 9.1 모델 정책

| 사용자 모드 | 모델 ID | 목적 |
|---|---|---|
| 빠른 번역(기본) | `gemini-3.5-flash-lite` | 무료 할당량, 속도와 대량 번역 우선 |
| 고품질 번역 | `gemini-3.7-flash` | 문체, 문맥과 지시사항 준수 우선 |

- 모델 목록은 앱 설정의 단일 상수에서 관리한다.
- Pro와 Preview 모델은 MVP에서 노출하지 않는다.
- 모델 변경은 캐시 키 변경으로 이어진다.
- 모델 접근이 거부되면 자동으로 다른 모델을 호출하여 예상치 못한 비용을 만들지 않고 사용자에게 선택을 요청한다.

### 9.2 요청 분할

- 문단 중간을 자르지 않는다.
- 각 요청은 문단 ID와 원문 텍스트의 배열로 구성한다.
- 정확한 토큰 한도는 샘플 장 벤치마크 후 결정하고 중앙 설정으로 관리한다.
- 첫 번역 표시 시간을 줄이기 위해 앞부분 묶음부터 처리한다.
- 동시 요청 수는 작은 고정값으로 제한하고 `429` 응답 시 줄인다.
- 사용자가 장을 이동하거나 취소하면 `AbortController`로 남은 요청을 중단한다.

### 9.3 출력 계약

Gemini에는 문단 ID와 번역 문자열로 이루어진 구조화 출력을 요청한다. 다음 조건을 검증한다.

- 요청한 ID만 존재한다.
- 모든 ID가 정확히 한 번 존재한다.
- 빈 번역문이 없다.
- 문단 순서가 원문과 대응된다.

검증 실패 시 해당 묶음만 제한된 횟수로 재시도한다. 그래도 실패하면 성공한 문단은 유지하고 실패한 범위를 사용자에게 표시한다.

### 9.4 재시도

- 네트워크 오류, `429`, 재시도 가능한 `5xx`: 지수 백오프와 jitter를 적용한다.
- 잘못된 API Key, 권한 없음, 모델 미지원: 재시도하지 않는다.
- 안전 정책 차단 또는 출력 계약 반복 실패: 해당 묶음을 실패 처리한다.
- 모든 재시도에는 상한을 두고 사용자 취소 신호를 존중한다.

## 10. 상태 관리

- 서버 데이터 로딩은 App Router와 Route Handler 경계를 사용한다.
- 리더의 일시적 상태는 가까운 Client Component의 `useReducer`로 관리한다.
- 전역 상태 라이브러리는 MVP에서 사용하지 않는다.
- 저장되는 상태는 `preferences.client.ts`와 `reader-db.client.ts`를 통해서만 읽고 쓴다.
- 탭 간 설정 동기화가 필요하면 `storage` 이벤트를 사용한다.

리더 상태는 다음 상태 머신을 따른다.

```text
idle → importing_epub → checking_storage → opening_local_chapter → checking_cache
idle → fetching_source → parsing_response ────────────────────────────┘
checking_cache → translating → complete
              └────────────→ partial_failure
각 상태 → cancelled | failed
```

## 11. 로컬 저장 전략

### localStorage

- Gemini API Key
- 사용자 프롬프트
- 선택 모델
- 글자 크기, 줄 간격, 보기 모드
- 마지막 EPUB 장 또는 웹 URL과 스크롤 위치

API Key는 사용자가 명시적으로 저장을 선택했을 때만 기록하는 방안을 UI 구현 시 우선 검토한다. 저장된 키는 XSS에 노출될 수 있으므로 강한 CSP와 제3자 스크립트 배제가 필수다.

### IndexedDB

- EPUB 책 메타데이터와 압축 archive의 256KB 이하 Base64 조각·정규화된 장 경로는 별도 record로 저장한다. 장 원문은 저장하지 않으며, 저장된 archive 조각을 결합해 요청한 장만 다시 추출한다.
- 장 source·번역 cache는 기본 최대 100MB 내에서 최근 사용 시각 기준 LRU 정리한다.
- 새 EPUB 가져오기 전 `navigator.storage.estimate()`로 여유 공간을 검사하고, 사용자 동작에서 `navigator.storage.persist()`를 요청한다.
- quota 부족 시 source·번역 cache만 정리할 수 있으며, EPUB archive와 책 메타데이터는 사용자 확인 없이 삭제하지 않는다. 필요한 공간을 확보하지 못하면 가져오기를 실패시킨다.
- 원문 해시가 같은 번역은 만료 없이 재사용
- 목차는 24시간 뒤 stale 처리하고 백그라운드 또는 사용자 진입 시 갱신
- 전체 데이터 삭제 기능은 localStorage, IndexedDB, Cache Storage를 모두 비운다.

## 12. PWA 및 오프라인

- Web App Manifest에 이름, 아이콘, 시작 URL, 테마 색상과 `display: standalone`을 설정한다.
- Service Worker는 빌드 식별자가 포함된 앱 셸과 정적 자산만 캐시한다. production 빌드는 배포마다 불변인 `PWA_BUILD_ID`를 설정해야 하며, 같은 배포의 모든 인스턴스는 같은 값을 사용한다.
- `/api/**`, Gemini API, 외부 e-book URL과 API Key가 포함될 수 있는 요청은 Service Worker 캐시 대상에서 제외한다.
- 오프라인에서는 IndexedDB의 EPUB archive 또는 저장된 장 원문을 다시 열 수 있고, cache된 번역만 표시할 수 있다.
- 오프라인 상태에서 신규 URL을 열면 네트워크가 필요하다는 오류를 표시한다.
- 새 Service Worker가 준비되면 사용자의 독서 흐름을 끊지 않는 시점에 갱신한다.

## 13. 보안

### 13.1 SSRF 방어

서버 fetch 전에 다음을 모두 적용한다.

1. `https`를 기본으로 허용하고 사이트가 꼭 필요한 경우에만 `http`를 명시적으로 허용한다.
2. 등록된 정확한 hostname만 허용한다. 문자열 suffix 비교만 사용하지 않는다.
3. 사용자 정보가 포함된 URL과 80/443 외 포트를 거부한다.
4. hostname을 DNS 해석하고 모든 결과가 공인 IP인지 검사한다.
5. 리다이렉트는 자동 추적하지 않고 최대 횟수 안에서 목적지를 매번 재검증한다.
6. 루프백, 사설망, 링크 로컬, 멀티캐스트, 예약 IP 범위를 IPv4와 IPv6 모두 차단한다.
7. 연결·전체 응답 시간, 최대 응답 바이트와 `text/html` 콘텐츠 타입을 제한한다.
8. 원본 사이트에 쿠키, Authorization 헤더 또는 사용자 제공 헤더를 전달하지 않는다.

DNS 검증과 실제 연결 사이의 재바인딩 가능성도 고려하여 배포 환경이 제공하는 고정 DNS/egress 제어를 함께 사용한다.

### 13.2 XSS와 콘텐츠 격리

- EPUB archive는 브라우저 전용 파서가 중앙 디렉터리를 먼저 검사한 뒤에만 해제한다. 압축 파일·항목·비압축 총량·장·문단 한도를 넘는 입력은 처리하지 않는다.
- 추출한 HTML 문자열을 React의 HTML 주입 API로 렌더링하지 않는다.
- 파서에서 얻은 `textContent`만 데이터로 반환한다.
- 외부 이미지, 스타일, iframe과 스크립트를 리더에 삽입하지 않는다.
- 가능한 한 엄격한 Content Security Policy를 적용하며 `connect-src`에는 앱 API와 Gemini API만 허용한다.
- 인라인 스크립트와 불필요한 제3자 분석 스크립트를 사용하지 않는다.

### 13.3 비밀값과 개인정보

- API Key를 URL이나 서버 요청에 포함하지 않는다.
- 로그 및 오류 객체를 전송하기 전에 비밀값 패턴을 제거한다.
- Gemini 호출을 Service Worker가 가로채거나 캐시하지 않게 한다.
- 무료 등급의 데이터 처리 정책을 최초 설정에서 안내한다.

## 14. 오류 모델

```ts
type PublicErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_SITE"
  | "SOURCE_BLOCKED"
  | "SOURCE_UNREACHABLE"
  | "SOURCE_TOO_LARGE"
  | "EXTRACTION_FAILED"
  | "INVALID_EPUB"
  | "EPUB_TOO_LARGE"
  | "EPUB_UNSUPPORTED"
  | "INVALID_API_KEY"
  | "MODEL_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "TRANSLATION_BLOCKED"
  | "TRANSLATION_FAILED"
  | "STORAGE_FULL"
  | "OFFLINE";
```

공개 오류에는 코드, 사용자용 메시지와 재시도 가능 여부만 포함한다. 내부 URL 검증 상세, upstream 응답과 스택 트레이스는 노출하지 않는다.

## 15. 테스트 전략

### 단위 테스트

- URL 정규화와 허용·차단 규칙
- IPv4/IPv6 사설 주소 판별
- 69shuba 장·목차 fixture 파싱
- 합성 EPUB fixture의 컨테이너·OPF·spine·navigation·XHTML 파싱 및 local-epub locator
- 손상 컨테이너, ZIP 폭탄 한도, XML/XHTML 오류, 빈 장과 잘못된 목차 거부
- 문단 ID, 콘텐츠 해시와 번역 캐시 키
- 문단 묶음 분할과 출력 계약 검증
- 오류 코드 매핑과 LRU 정리

### 통합 테스트

- Route Handler부터 추출기까지의 성공·실패 응답
- 리다이렉트 목적지 재검증
- 캐시 hit/miss와 프롬프트·모델 변경에 따른 무효화
- Gemini 응답의 누락, 중복, `429`, 취소 처리
- 전체 저장 데이터 삭제
- EPUB library migration, 저장공간 부족, 오프라인 재열기와 local locator의 서버 API 거부

외부 HTTP와 Gemini는 테스트 더블로 대체하며 실제 네트워크를 호출하지 않는다.

### E2E 테스트

- API Key 설정 → EPUB 선택 → 번역 진행 → 리더 표시
- 원문/번역문 보기 전환
- 이전 장, 다음 장 및 내부 목차 이동
- 재방문 시 캐시 사용
- EPUB 첫 장 번역 → 다음 장·목차 이동 → 새로고침 후 cache 재사용 → 오프라인 재열기
- 모바일 360px 레이아웃과 키보드 접근성

## 16. 관측성과 로그

- 서버 로그는 요청 ID, 사이트 ID, 결과 코드, 처리 시간과 응답 크기만 구조화해 남긴다.
- 전체 원본 URL은 경로에 작품 ID가 포함될 수 있으므로 기본 로그에서 해시하거나 필요한 부분만 기록한다.
- 원문, 번역문, 사용자 프롬프트, API Key는 기록하지 않는다.
- EPUB 파일명, archive Blob과 EPUB에서 추출한 본문도 기록하지 않는다.
- 클라이언트 오류 보고를 도입할 경우 사용자의 명시적 동의와 비밀값 제거를 선행한다.

## 17. 배포 고려사항

- 외부 HTTP 요청과 DNS 검증을 지원하는 Node.js 런타임에 배포한다.
- 서버리스 플랫폼의 요청 시간·응답 크기·egress 제한이 목차 수집 요구사항을 충족하는지 확인한다.
- `www.69shuba.com` 접근 가능 여부와 문자 인코딩을 배포 리전에서 검증한다.
- 강한 CSP, HSTS, `Referrer-Policy`, `X-Content-Type-Options` 등 보안 헤더를 설정한다.
- 모델 ID와 지원 사이트 목록은 배포 없이 또는 단일 설정 변경으로 교체할 수 있게 중앙화한다.

## 18. 확장 지점

- 새 사이트: `SiteExtractor` 구현과 fixture 계약 테스트 추가
- 새 번역 모델: 모델 카탈로그 설정과 품질 평가 후 허용 목록에 추가
- 새 대상 언어: 프롬프트, 캐시 키와 UI 설정 확장
- 서버 동기화: 향후 계정·DB가 도입되더라도 브라우저 저장 인터페이스 뒤에 추가

MVP에서는 범용 사이트 자동 추출, 로그인 콘텐츠, 서버 번역, 서버 공유 캐시, EPUB 서버 업로드 및 전체 책 일괄 번역으로 확장하지 않는다.
