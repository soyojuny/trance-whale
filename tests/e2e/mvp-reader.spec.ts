import { expect, test, type Page, type Route } from "@playwright/test";
import { syntheticEpubArchive } from "../fixtures/epub/synthetic-epub";

const API_KEY = "e2e-browser-only-key";
const CHAPTER_ONE = "https://www.69shuba.com/txt/48273/1";
const CHAPTER_TWO = "https://www.69shuba.com/txt/48273/2";
const CATALOG = "https://www.69shuba.com/book/48273/";
const EPUB_FILENAME = "synthetic-reader.epub";
const EPUB_API_KEY = "e2e-local-epub-key";

function chapter(url: string, number: number) {
  return {
    kind: "chapter", sourceUrl: url, canonicalUrl: url, siteId: "69shuba",
    bookId: "48273", bookTitle: "검선독존", chapterId: String(number), chapterNumber: number,
    chapterTitle: `제${number}화 산문`,
    paragraphs: [
      { id: "p-1", text: `第${number}章 第一段原文。${"甲".repeat(3_500)}` },
      { id: "p-2", text: `第${number}章 第二段原文。${"乙".repeat(3_500)}` },
    ],
    navigation: {
      ...(number > 1 ? { previous: { url: CHAPTER_ONE, label: "제1화" } } : {}),
      catalog: { url: CATALOG, label: "목차" },
      ...(number < 2 ? { next: { url: CHAPTER_TWO, label: "제2화" } } : {}),
    },
    contentHash: String(number).repeat(64), fetchedAt: "2026-09-04T00:00:00.000Z",
  };
}

async function mockBoundaries(page: Page) {
  const geminiRequests: string[] = [];
  const serverRequests: string[] = [];
  const blockedTranslationIds: string[][] = [];
  let translationMode: "success" | "blocked-once" | "delayed" = "success";
  await page.route("**/api/source/chapter", async (route) => {
    const body = route.request().postData() ?? "";
    serverRequests.push(`${route.request().url()} ${body}`);
    const url = (JSON.parse(body) as { url: string }).url;
    await route.fulfill({ json: chapter(url, url.endsWith("/2") ? 2 : 1) });
  });
  await page.route("**/api/source/catalog", async (route) => {
    serverRequests.push(`${route.request().url()} ${route.request().postData() ?? ""}`);
    await route.fulfill({ json: {
      kind: "catalog", sourceUrl: CATALOG, canonicalUrl: CATALOG, siteId: "69shuba",
      bookId: "48273", bookTitle: "검선독존", fetchedAt: "2026-09-04T00:00:00.000Z",
      chapters: [1, 2].map((number) => ({ id: String(number), url: number === 1 ? CHAPTER_ONE : CHAPTER_TWO, title: `제${number}화 산문`, number, sourceIndex: number - 1 })),
    } });
  });
  await page.route("https://generativelanguage.googleapis.com/**", async (route: Route) => {
    geminiRequests.push(route.request().postData() ?? "");
    expect(route.request().headers()["x-goog-api-key"]).toBe(API_KEY);
    const body = route.request().postDataJSON() as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
    const text = body.contents?.[0]?.parts?.[0]?.text ?? "";
    if (text === "Reply with ok.") {
      await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } });
      return;
    }
    if (translationMode === "delayed") await new Promise((resolve) => setTimeout(resolve, 800));
    if (translationMode === "blocked-once") {
      translationMode = "success";
      blockedTranslationIds.push((JSON.parse(text) as { paragraphs: Array<{ id: string }> }).paragraphs.map(({ id }) => id));
      await route.fulfill({ json: { promptFeedback: { blockReason: "SAFETY" } } });
      return;
    }
    const parsed = JSON.parse(text) as { paragraphs: Array<{ id: string }> };
    const translations = parsed.paragraphs.map(({ id }) => ({ id, text: `${id} 한국어 번역` }));
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ translations }) }] } }] })}\n\n`,
    });
  });
  return {
    geminiRequests,
    serverRequests,
    blockedTranslationIds,
    setTranslationMode(mode: typeof translationMode) { translationMode = mode; },
  };
}

function translationRequestIds(requests: readonly string[]): string[][] {
  return requests.flatMap((request) => {
    try {
      const body = JSON.parse(request) as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
      const text = body.contents?.[0]?.parts?.[0]?.text;
      if (!text || text === "Reply with ok.") return [];
      return [(JSON.parse(text) as { paragraphs: Array<{ id: string }> }).paragraphs.map(({ id }) => id)];
    } catch {
      return [];
    }
  });
}

async function saveKeyAndOpen(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^설정( 열기)?$/ }).click();
  await page.getByLabel("Gemini API Key").fill(API_KEY);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page.getByText("저장됨 · 다음 장부터 적용")).toBeVisible();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.getByRole("button", { name: "웹 페이지 가져오기" }).click();
  await page.getByLabel("웹소설 장 URL").fill(CHAPTER_ONE);
  await page.getByRole("button", { name: "번역해서 읽기" }).click();
  await expect(page.getByRole("heading", { name: "제1화 산문" })).toBeVisible();
}

async function saveKeyForLocalEpub(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "설정 열기" }).click();
  await page.getByLabel("Gemini API Key").fill(EPUB_API_KEY);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page.getByText("저장됨 · 다음 장부터 적용")).toBeVisible();
  await page.getByRole("button", { name: "설정 닫기" }).click();
}

async function localEpubStorage(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("trance-whale-reader");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const read = (storeName: string) => new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const [books, archives, sources, translations] = await Promise.all([
      read("local-epub-books"),
      read("local-epub-archives"),
      read("source-cache"),
      read("translation-cache"),
    ]);
    database.close();
    return { books, archives, sources, translations };
  });
}

test("합성 EPUB을 기기에서 번역·탐색하고 reload 및 offline에서 cache를 복원한다", async ({ page, context }) => {
  const geminiRequests: string[] = [];
  const sourceRequests: string[] = [];
  await page.route("**/api/source/**", async (route) => {
    sourceRequests.push(route.request().url());
    await route.abort();
  });
  await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
    geminiRequests.push(route.request().postData() ?? "");
    expect(route.request().headers()["x-goog-api-key"]).toBe(EPUB_API_KEY);
    const request = route.request().postDataJSON() as { contents?: Array<{ parts?: Array<{ text?: string }> }> };
    const text = request.contents?.[0]?.parts?.[0]?.text ?? "";
    if (text === "Reply with ok.") {
      await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: "ok" }] } }] } });
      return;
    }
    const paragraphs = (JSON.parse(text) as { paragraphs: Array<{ id: string }> }).paragraphs;
    await route.fulfill({ json: {
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        translations: paragraphs.map(({ id }) => ({ id, text: `${id} EPUB 번역` })),
      }) }] } }],
    } });
  });

  await saveKeyForLocalEpub(page);
  await page.getByLabel("EPUB 파일 선택").setInputFiles({
    name: EPUB_FILENAME,
    mimeType: "application/epub+zip",
    buffer: Buffer.from(syntheticEpubArchive()),
  });
  await expect(page).toHaveURL(/\/read\?book=[a-f0-9]{64}&chapter=0/);
  await expect(page.getByRole("heading", { name: "첫 항해" })).toBeVisible();
  await expect(page.getByText("p-1 EPUB 번역")).toBeVisible();
  await expect(page.locator(".reader-section script, .reader-section iframe")).toHaveCount(0);
  await expect(page.locator(".reader-section")).not.toContainText("window.bad");

  const firstChapterRequests = geminiRequests.length;
  await page.getByRole("button", { name: "다음 장: 둘째 항해" }).first().click();
  await expect(page).toHaveURL(/\/read\?book=[a-f0-9]{64}&chapter=1/);
  await expect(page.getByRole("heading", { name: "둘째 항해" })).toBeVisible();
  await expect(page.getByText("p-1 EPUB 번역")).toBeVisible();
  await expect.poll(() => geminiRequests.length).toBeGreaterThan(firstChapterRequests);

  await page.getByRole("button", { name: "목차 열기", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "목차" })).toBeVisible();
  await page.getByRole("button", { name: /첫 항해/ }).click();
  await expect(page.getByRole("heading", { name: "첫 항해" })).toBeVisible();
  await expect.poll(() => geminiRequests.length).toBe(firstChapterRequests + 1);

  const storage = await localEpubStorage(page);
  expect(storage.books).toHaveLength(1);
  expect(storage.archives).toHaveLength(1);
  expect(storage.sources).toHaveLength(0);
  expect(storage.translations).toHaveLength(2);
  expect(JSON.stringify({ books: storage.books, archives: storage.archives })).not.toContain(EPUB_FILENAME);
  expect(JSON.stringify(storage)).not.toContain(EPUB_API_KEY);
  expect(sourceRequests).toEqual([]);

  const beforeReload = geminiRequests.length;
  await page.reload();
  await expect(page.getByRole("heading", { name: "첫 항해" })).toBeVisible();
  await expect(page.getByText("p-1 EPUB 번역")).toBeVisible();
  expect(geminiRequests).toHaveLength(beforeReload);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "첫 항해" })).toBeVisible();
  await expect(page.getByText("p-1 EPUB 번역")).toBeVisible();
  expect(geminiRequests).toHaveLength(beforeReload);
  expect(sourceRequests).toEqual([]);

  const cacheEntries = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(names.map(async (name) => {
      const cache = await caches.open(name);
      return (await cache.keys()).map((request) => request.url);
    }));
    return entries.flat();
  });
  expect(JSON.stringify(cacheEntries)).not.toContain(EPUB_API_KEY);
  expect(JSON.stringify(cacheEntries)).not.toContain(EPUB_FILENAME);
  expect(cacheEntries.some((url) => url.includes("/api/") || url.includes("generativelanguage.googleapis.com"))).toBe(false);
});

test("설정부터 번역, 보기 모드와 내부 장·목차 이동까지 완료한다", async ({ page }) => {
  const boundaries = await mockBoundaries(page);
  await saveKeyAndOpen(page);
  await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
  await expect(page.getByText("완료", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "원문", exact: true }).click();
  await expect(page.getByText(/^第1章 第一段原文。/)).toBeVisible();
  await page.getByRole("button", { name: "함께 보기" }).click();
  await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
  await page.getByRole("button", { name: /다음 장: 제2화/ }).first().click();
  await expect(page).toHaveURL(/\/read\?url=/);
  await expect(page.getByRole("heading", { name: "제2화 산문" })).toBeVisible();
  await page.getByRole("button", { name: "목차 열기", exact: true }).click();
  await page.getByLabel("장 번호 또는 제목 검색").fill("1화");
  await page.getByRole("button", { name: "역순으로 정렬" }).click();
  await page.getByRole("button", { name: /제1화 산문/ }).click();
  await expect(page.getByRole("heading", { name: "제1화 산문" })).toBeVisible();
  expect(boundaries.serverRequests.join(" ")).not.toContain(API_KEY);
  expect(page.url()).not.toContain(API_KEY);
});

test("reload에서 설정과 번역 cache를 복원하고 360px에서 overflow가 없다", async ({ page }) => {
  const boundaries = await mockBoundaries(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await saveKeyAndOpen(page);
  const translatedRequests = boundaries.geminiRequests.length;
  await page.reload();
  await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
  expect(boundaries.geminiRequests).toHaveLength(translatedRequests);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const targets = await page.locator(".mobile-reader-tools button:visible").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(targets).toHaveLength(5);
  expect(targets.every((height) => height >= 44)).toBe(true);
});

test("모델·프롬프트 변경 후 reload는 저장된 번역을 유지하고 명시적 재번역만 API를 호출한다", async ({ page }) => {
  const boundaries = await mockBoundaries(page);
  await saveKeyAndOpen(page);
  await expect(page.getByText("p-2 한국어 번역")).toBeVisible();
  const geminiCount = boundaries.geminiRequests.length;

  for (const setting of ["model", "prompt"]) {
    await page.getByRole("button", { name: "설정", exact: true }).click();
    if (setting === "model") {
      await page.getByRole("radio", { name: /고품질 번역/ }).check();
    } else {
      await page.locator("#reader-user-prompt").fill("이름과 말투를 유지해 주세요.");
    }
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await page.reload();
    await expect(page.getByText("p-2 한국어 번역")).toBeVisible();
    expect(boundaries.geminiRequests).toHaveLength(geminiCount);
  }

  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("button", { name: "현재 장 다시 번역" }).click();
  await expect.poll(() => boundaries.geminiRequests.length).toBeGreaterThan(geminiCount);
  expect(boundaries.geminiRequests.at(-1)).toContain("이름과 말투를 유지해 주세요.");
});

test("리더의 다시 불러오기와 현재 장 다시 번역을 실제 세션에 연결한다", async ({ page }) => {
  const boundaries = await mockBoundaries(page);
  await saveKeyAndOpen(page);
  const sourceCount = boundaries.serverRequests.length;
  const geminiCount = boundaries.geminiRequests.length;
  await page.getByRole("button", { name: "현재 장 다시 불러오기" }).click();
  await expect.poll(() => boundaries.serverRequests.length).toBeGreaterThan(sourceCount);
  await page.getByRole("button", { name: "읽기 및 번역 설정 열기" }).click();
  await page.getByRole("button", { name: "현재 장 다시 번역" }).click();
  await expect.poll(() => boundaries.geminiRequests.length).toBeGreaterThan(geminiCount);
});

test("취소와 부분 실패 재시도가 성공한 문단을 버리지 않는다", async ({ page }) => {
  const boundaries = await mockBoundaries(page);
  await page.goto("/");
  await page.getByRole("button", { name: "설정 열기" }).click();
  await page.getByLabel("Gemini API Key").fill(API_KEY);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await page.getByRole("button", { name: "설정 닫기" }).click();

  boundaries.setTranslationMode("delayed");
  await page.getByRole("button", { name: "웹 페이지 가져오기" }).click();
  await page.getByLabel("웹소설 장 URL").fill(CHAPTER_ONE);
  await page.getByRole("button", { name: "번역해서 읽기" }).click();
  await page.getByRole("button", { name: "번역 취소" }).click();
  await expect(page.getByText("번역 취소됨")).toBeVisible();

  boundaries.setTranslationMode("blocked-once");
  await page.getByRole("button", { name: "현재 장 다시 불러오기" }).click();
  await expect(page.locator(".translation-failure")).toContainText("번역하지 못한 문단");
  await page.getByRole("button", { name: "실패한 문단 다시 번역" }).click();
  await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
});

test("부분 실패 재시도는 실패한 chunk만 Gemini에 다시 보낸다", async ({ page }) => {
  const boundaries = await mockBoundaries(page);
  await page.goto("/");
  await page.getByRole("button", { name: "설정 열기" }).click();
  await page.getByLabel("Gemini API Key").fill(API_KEY);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await page.getByRole("button", { name: "설정 닫기" }).click();

  boundaries.setTranslationMode("blocked-once");
  await page.getByRole("button", { name: "웹 페이지 가져오기" }).click();
  await page.getByLabel("웹소설 장 URL").fill(CHAPTER_ONE);
  await page.getByRole("button", { name: "번역해서 읽기" }).click();
  await expect(page.locator(".translation-failure")).toContainText("번역하지 못한 문단");
  const beforeRetry = translationRequestIds(boundaries.geminiRequests);
  expect(boundaries.blockedTranslationIds).toHaveLength(1);

  await page.getByRole("button", { name: "실패한 문단 다시 번역" }).click();
  await expect(page.getByText("완료", { exact: true })).toBeVisible();
  const retryRequests = translationRequestIds(boundaries.geminiRequests).slice(beforeRetry.length);
  expect(retryRequests).toEqual(boundaries.blockedTranslationIds);
});

test("production Service Worker에서 cached 장은 실제 offline reload로 복원하고 신규 장은 OFFLINE을 안내한다", async ({ page, context }) => {
  const boundaries = await mockBoundaries(page);
  await saveKeyAndOpen(page);
  const serviceWorkerReady = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  expect(serviceWorkerReady).toBe(true);

  await page.unroute("**/api/source/chapter");
  await page.unroute("**/api/source/catalog");
  await page.unroute("https://generativelanguage.googleapis.com/**");
  const offlineBoundaryRequests: string[] = [];
  const trackBoundaryRequest = (request: { url(): string }) => {
    if (request.url().includes("/api/source/") || request.url().startsWith("https://generativelanguage.googleapis.com/")) {
      offlineBoundaryRequests.push(request.url());
    }
  };
  context.on("request", trackBoundaryRequest);
  await context.setOffline(true);
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "제1화 산문" })).toBeVisible();
  await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
  await page.getByRole("button", { name: "원문", exact: true }).click();
  await expect(page.getByText(/^第1章 第一段原文。/)).toBeVisible();
  await expect(page.getByRole("button", { name: "이전 장 없음" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "목차 열기", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "다음 장: 제2화" }).first()).toBeEnabled();
  await page.goto(`/read?url=${encodeURIComponent(CHAPTER_TWO)}`);
  await expect(page.getByText("새 콘텐츠를 열려면 네트워크 연결이 필요합니다.")).toBeVisible();
  expect(offlineBoundaryRequests).toEqual([]);
  expect(boundaries.serverRequests).toHaveLength(1);
});

for (const width of [360, 1280]) {
  test(`${width}px 리더 설정과 스크롤 방향에 따른 모바일 도구막대`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 740 });
    await mockBoundaries(page);
    await saveKeyAndOpen(page);
    await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
    const toolbar = page.getByRole("navigation", { name: "모바일 독서 도구" });
    const settings = page.getByRole("button", { name: width === 360 ? "읽기 및 번역 설정 열기" : "설정", exact: true });
    await settings.click();
    await expect(page.getByRole("dialog", { name: "읽기 및 번역 설정" })).toBeVisible();
    await page.getByLabel("나만의 번역 지시").fill("말투를 유지해 주세요.");
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await page.screenshot({ path: testInfo.outputPath(`settings-${width}.png`), style: ".reading-copy { visibility: hidden; }", mask: [page.getByLabel("Gemini API Key")] });
    await page.getByRole("button", { name: "설정 닫기" }).click();
    await expect(settings).toBeFocused();
    await settings.click();
    await expect(page.getByLabel("나만의 번역 지시")).toHaveValue("말투를 유지해 주세요.");
    await page.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await page.getByRole("button", { name: "원문", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 360) {
      await expect(toolbar).toBeInViewport();
      const sizes = await toolbar.getByRole("button").evaluateAll((buttons) => buttons.map((button) => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
      expect(sizes).toHaveLength(5);
      expect(sizes.every((size) => size.width >= 44 && size.height >= 44)).toBe(true);
      await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
      await expect(page.locator(".mobile-reader-tools")).toHaveAttribute("inert", "");
      await expect(page.locator(".mobile-reader-tools")).not.toBeInViewport();
      await settings.evaluate((button) => (button as HTMLElement).focus());
      await expect(settings).not.toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("reader-hidden-360.png"), style: ".reading-copy { visibility: hidden; }" });
      await page.evaluate(() => window.scrollTo({ top: 550, behavior: "instant" }));
      await expect(toolbar).not.toHaveAttribute("inert", "");
      await expect(toolbar).toBeInViewport();
      const catalog = toolbar.getByRole("button", { name: "목차 열기 (모바일)" });
      await catalog.click();
      await expect(page.getByLabel("장 번호 또는 제목 검색")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(catalog).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("reader-visible-360.png"), style: ".reading-copy { visibility: hidden; }" });
      await toolbar.getByRole("button", { name: "다음 장: 제2화" }).click();
      await expect(page.getByRole("heading", { name: "제2화 산문" })).toBeVisible();
      await expect(toolbar).toBeInViewport();
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    } else {
      await expect(toolbar).toBeHidden();
      await page.evaluate(() => window.scrollTo({ top: 650, behavior: "instant" }));
      await expect(settings).toBeInViewport();
      await settings.click();
      await page.keyboard.press("Escape");
      await expect(settings).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath("reader-desktop.png"), style: ".reading-copy { visibility: hidden; }" });
    }
  });
}

test("키보드로 보기 모드와 dialog를 조작하고 닫은 뒤 focus를 복원한다", async ({ page }) => {
  await mockBoundaries(page);
  await saveKeyAndOpen(page);
  await page.getByRole("button", { name: "함께 보기" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "함께 보기" })).toHaveAttribute("aria-pressed", "true");
  const settingsButton = page.getByRole("button", { name: "읽기 및 번역 설정 열기" });
  await settingsButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "읽기 및 번역 설정" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settingsButton).toBeFocused();
  const catalogButton = page.getByRole("button", { name: "목차", exact: true });
  await catalogButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("장 번호 또는 제목 검색")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(catalogButton).toBeFocused();
});
