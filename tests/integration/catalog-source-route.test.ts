import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SourceContractError } from "../../src/lib/errors";
import type {
  SourceFetch,
  SourceUrlValidator,
} from "../../src/lib/source/fetch-source.server";
import {
  createCatalogSourceHandler,
  runtime,
} from "../../src/app/api/source/catalog/route";

const catalogUrl = "https://www.69shuba.com/book/48273/";

function jsonRequest(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/source/catalog", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

function htmlResponse(html: string, status = 200, headers: HeadersInit = {}) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

describe("POST /api/source/catalog", () => {
  let page1: string;
  let page2: string;
  let page3: string;
  let singlePage: string;

  beforeEach(async () => {
    [page1, page2, page3, singlePage] = await Promise.all([
      readFile("tests/fixtures/69shuba/catalog-page-1.html", "utf8"),
      readFile("tests/fixtures/69shuba/catalog-page-2.html", "utf8"),
      readFile("tests/fixtures/69shuba/catalog-page-3.html", "utf8"),
      readFile("tests/fixtures/69shuba/catalog-single.html", "utf8"),
    ]);
  });

  it("uses Node.js and returns a schema-valid single-page catalog without caching", async () => {
    const validateUrl = vi.fn<SourceUrlValidator>(async (input) => new URL(input));
    const fetchImpl = vi.fn<SourceFetch>().mockResolvedValue(htmlResponse(singlePage));
    const response = await createCatalogSourceHandler({
      fetchDependencies: { validateUrl, fetchImpl },
    })(jsonRequest(JSON.stringify({ url: catalogUrl })));
    const result = await response.json();

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result).toMatchObject({
      kind: "catalog",
      canonicalUrl: "https://www.69shuba.com/book/48273",
      bookTitle: "深海行者",
    });
    expect(result.chapters).toHaveLength(2);
    expect(validateUrl).toHaveBeenCalledWith(catalogUrl);
  });

  it("merges pages in source order and revalidates follow-up redirects", async () => {
    const terminalPage3 = page3.replace(/<nav[\s\S]*?<\/nav>/, "");
    const validateUrl = vi.fn<SourceUrlValidator>(async (input) => new URL(input));
    const fetchImpl = vi.fn<SourceFetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/48273/")) return htmlResponse(page1);
      if (url.endsWith("/2.html")) {
        return htmlResponse("", 302, { location: "/book/48273/3.html" });
      }
      return htmlResponse(terminalPage3);
    });
    const response = await createCatalogSourceHandler({
      fetchDependencies: { validateUrl, fetchImpl },
    })(jsonRequest(JSON.stringify({ url: catalogUrl })));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.chapters.map((chapter: { id: string }) => chapter.id)).toEqual([
      "chapter-32028706",
      "chapter-32028707",
      "chapter-32028709",
    ]);
    expect(validateUrl.mock.calls.map(([url]) => url)).toEqual([
      catalogUrl,
      "https://www.69shuba.com/book/48273/2.html",
      "https://www.69shuba.com/book/48273/3.html",
    ]);
  });

  it.each([
    ["cycle", pageFixture("cycle")],
    ["page limit", pageFixture("limit")],
  ])("maps a pagination %s to a safe extraction error", async (_name, mode) => {
    const fetchImpl = vi.fn<SourceFetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/48273/")) return htmlResponse(page1);
      if (mode === "cycle") return htmlResponse(page3);
      return htmlResponse(page2.replace("/3.html", "/4.html"));
    });
    const response = await createCatalogSourceHandler({
      maxPages: 2,
      fetchDependencies: {
        validateUrl: async (input) => new URL(input),
        fetchImpl,
      },
    })(jsonRequest(JSON.stringify({ url: catalogUrl })));
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(body)).toEqual({
      code: "EXTRACTION_FAILED",
      message: "본문 정보를 추출할 수 없습니다.",
      retryable: false,
    });
    expect(body).not.toMatch(/cycle|limit|48273/);
  });

  it("maps a middle-page fetch failure without exposing upstream details", async () => {
    const privateDetail = "private upstream catalog response";
    const fetchSource = vi
      .fn()
      .mockResolvedValueOnce({ url: catalogUrl, html: page1, contentType: "text/html" })
      .mockRejectedValueOnce(
        new SourceContractError("SOURCE_UNREACHABLE", privateDetail),
      );
    const response = await createCatalogSourceHandler({ fetchSource })(
      jsonRequest(JSON.stringify({ url: catalogUrl })),
    );
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(JSON.parse(body)).toMatchObject({ code: "SOURCE_UNREACHABLE" });
    expect(body).not.toContain(privateDetail);
  });

  it.each([
    ["wrong content type", jsonRequest(JSON.stringify({ url: catalogUrl }), "text/plain")],
    ["malformed JSON", jsonRequest("{not-json")],
    ["secret field", jsonRequest(JSON.stringify({ url: catalogUrl, apiKey: "secret" }))],
  ])("rejects %s before fetching", async (_name, request) => {
    const fetchSource = vi.fn();
    const response = await createCatalogSourceHandler({ fetchSource })(request);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_URL" });
    expect(fetchSource).not.toHaveBeenCalled();
  });
});

function pageFixture(mode: "cycle" | "limit") {
  return mode;
}
