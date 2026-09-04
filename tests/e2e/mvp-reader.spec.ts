import { expect, test, type Page, type Route } from "@playwright/test";

const API_KEY = "e2e-browser-only-key";
const CHAPTER_ONE = "https://www.69shuba.com/txt/48273/1";
const CHAPTER_TWO = "https://www.69shuba.com/txt/48273/2";
const CATALOG = "https://www.69shuba.com/book/48273/";

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
      await route.fulfill({ json: { promptFeedback: { blockReason: "SAFETY" } } });
      return;
    }
    const parsed = JSON.parse(text) as { paragraphs: Array<{ id: string }> };
    const translations = parsed.paragraphs.map(({ id }) => ({ id, text: `${id} 한국어 번역` }));
    await route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ translations }) }] } }] } });
  });
  return { geminiRequests, serverRequests, setTranslationMode(mode: typeof translationMode) { translationMode = mode; } };
}

async function saveKeyAndOpen(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "설정 열기" }).click();
  await page.getByLabel("Gemini API Key").fill(API_KEY);
  await page.getByRole("button", { name: "변경사항 저장" }).click();
  await expect(page.getByText("저장됨 · 다음 장부터 적용")).toBeVisible();
  await page.getByRole("button", { name: "설정 닫기" }).click();
  await page.getByLabel("웹소설 장 URL").fill(CHAPTER_ONE);
  await page.getByRole("button", { name: "번역해서 읽기" }).click();
  await expect(page.getByRole("heading", { name: "제1화 산문" })).toBeVisible();
}

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
  expect(targets).toHaveLength(4);
  expect(targets.every((height) => height >= 44)).toBe(true);
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

test("production Service Worker에서 cached 장은 offline 재사용하고 신규 장은 OFFLINE을 안내한다", async ({ page, context }) => {
  await mockBoundaries(page);
  await saveKeyAndOpen(page);
  const serviceWorkerReady = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  expect(serviceWorkerReady).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("p-1 한국어 번역")).toBeVisible();
  await page.addInitScript(() => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }));
  await page.goto(`/read?url=${encodeURIComponent(CHAPTER_TWO)}`);
  await expect(page.getByText("새 콘텐츠를 열려면 네트워크 연결이 필요합니다.")).toBeVisible();
});

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
