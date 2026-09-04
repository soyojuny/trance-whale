import { describe, expect, it, vi } from "vitest";

import { toPublicError } from "../../src/lib/errors";
import {
  SourceClientError,
  createSourceClient,
} from "../../src/services/source-client.client";

const SOURCE_URL = "https://www.69shuba.com/txt/48273/32028706";
const SECRET = "test-secret-key";

const chapter = {
  kind: "chapter" as const,
  sourceUrl: SOURCE_URL,
  canonicalUrl: SOURCE_URL,
  siteId: "69shuba",
  bookId: "48273",
  chapterId: "32028706",
  chapterNumber: 1,
  chapterTitle: "第一章",
  paragraphs: [{ id: "p-1", text: "正文" }],
  navigation: {
    catalog: { url: "https://www.69shuba.com/book/48273/", label: "目录" },
  },
  contentHash: "a".repeat(64),
  fetchedAt: "2026-09-04T00:00:00.000Z",
};

const catalog = {
  kind: "catalog" as const,
  sourceUrl: "https://www.69shuba.com/book/48273/",
  canonicalUrl: "https://www.69shuba.com/book/48273/",
  siteId: "69shuba",
  bookId: "48273",
  bookTitle: "测试作品",
  chapters: [{ id: "32028706", url: SOURCE_URL, title: "第一章", number: 1, sourceIndex: 0 }],
  fetchedAt: "2026-09-04T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("source client", () => {
  it("reports OFFLINE without starting a new source request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createSourceClient(fetchImpl, () => false);

    const error = await client.fetchChapter(SOURCE_URL, new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "OFFLINE", retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["chapter", "/api/source/chapter", SOURCE_URL, chapter],
    ["catalog", "/api/source/catalog", catalog.sourceUrl, catalog],
  ] as const)("posts URL-only %s requests to the app API", async (kind, path, url, result) => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(result));
    const client = createSourceClient(fetchImpl);

    const response = kind === "chapter"
      ? await client.fetchChapter(url, signal)
      : await client.fetchCatalog(url, signal);

    expect(response).toEqual(result);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchImpl.mock.calls[0];
    expect(requestUrl).toBe(path);
    expect(init).toMatchObject({ method: "POST", signal });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ url });
    expect(String(init?.body)).not.toContain(SECRET);
  });

  it("validates the URL before making a request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createSourceClient(fetchImpl);

    const error = await client.fetchChapter("javascript:alert(1)", new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "INVALID_URL", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [jsonResponse({ ...chapter, paragraphs: [] }), "malformed success"],
    [new Response("not json", { status: 200 }), "invalid JSON success"],
    [new Response(`${SECRET} upstream HTML`, { status: 502 }), "invalid error response"],
  ])("maps %s to a safe contract error", async (response) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = createSourceClient(fetchImpl);

    const error = await client.fetchChapter(SOURCE_URL, new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceClientError);
    expect(error).toMatchObject({ code: "EXTRACTION_FAILED", retryable: false });
    expect(toPublicError(error)).toMatchObject({ code: "EXTRACTION_FAILED" });
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect((error as Error).message).not.toContain(SOURCE_URL);
    expect((error as Error).message).not.toContain("upstream HTML");
  });

  it("preserves a valid public error without exposing extra response fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      code: "SOURCE_UNREACHABLE",
      message: "원본 사이트에 연결할 수 없습니다.",
      retryable: true,
      detail: `${SECRET} upstream detail`,
    }, 502));
    const client = createSourceClient(fetchImpl);

    const error = await client.fetchChapter(SOURCE_URL, new AbortController().signal)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "EXTRACTION_FAILED", retryable: false });
    expect(JSON.stringify(error)).not.toContain(SECRET);

    fetchImpl.mockResolvedValueOnce(jsonResponse({
      code: "SOURCE_UNREACHABLE",
      message: "원본 사이트에 연결할 수 없습니다.",
      retryable: true,
    }, 502));
    const publicError = await client.fetchChapter(SOURCE_URL, new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(publicError).toMatchObject({ code: "SOURCE_UNREACHABLE", retryable: true });
  });

  it("maps network failures but preserves aborts and performs no retry", async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(`${SECRET} network detail`));
    const networkClient = createSourceClient(networkFetch);
    const networkError = await networkClient.fetchChapter(SOURCE_URL, new AbortController().signal)
      .catch((caught: unknown) => caught);
    expect(networkError).toMatchObject({ code: "SOURCE_UNREACHABLE", retryable: true });
    expect(JSON.stringify(networkError)).not.toContain(SECRET);
    expect(networkFetch).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const abortFetch = vi.fn<typeof fetch>().mockRejectedValue(abortError);
    const abortClient = createSourceClient(abortFetch);
    await expect(abortClient.fetchChapter(SOURCE_URL, controller.signal)).rejects.toBe(abortError);
    expect(abortFetch.mock.calls[0][1]?.signal).toBe(controller.signal);
    expect(abortFetch).toHaveBeenCalledTimes(1);
  });
});
