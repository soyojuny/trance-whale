import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SourceContractError } from "../../src/lib/errors";
import type {
  FetchedSourceHtml,
  SourceFetch,
  SourceUrlValidator,
} from "../../src/lib/source/fetch-source.server";
import {
  createChapterSourceHandler,
  runtime,
} from "../../src/app/api/source/chapter/route";

const sourceUrl = "https://www.69shuba.com/txt/48273/32028706";
const fixturePath = "tests/fixtures/69shuba/chapter.html";

function jsonRequest(body: string, contentType = "application/json") {
  return new Request("http://localhost/api/source/chapter", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

function fetched(html: string): FetchedSourceHtml {
  return { url: sourceUrl, html, contentType: "text/html; charset=utf-8" };
}

describe("POST /api/source/chapter", () => {
  let html: string;

  beforeEach(async () => {
    html = await readFile(fixturePath, "utf8");
  });

  it("uses the Node.js runtime and returns a schema-valid chapter without caching", async () => {
    const validateUrl = vi.fn<SourceUrlValidator>(async (input) => new URL(input));
    const fetchImpl = vi.fn<SourceFetch>().mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const handler = createChapterSourceHandler({
      fetchDependencies: { validateUrl, fetchImpl },
    });

    const response = await handler(jsonRequest(JSON.stringify({ url: sourceUrl })));
    const result = await response.json();

    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result).toMatchObject({
      kind: "chapter",
      canonicalUrl: sourceUrl,
      siteId: "69shuba",
      chapterId: "32028706",
    });
    expect(result.paragraphs.length).toBeGreaterThan(0);
    expect(validateUrl).toHaveBeenCalledWith(sourceUrl);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing content type", jsonRequest(JSON.stringify({ url: sourceUrl }), "text/plain")],
    ["malformed JSON", jsonRequest("{not-json")],
    ["invalid URL", jsonRequest(JSON.stringify({ url: "not a URL" }))],
    [
      "translation secret fields",
      jsonRequest(JSON.stringify({ url: sourceUrl, apiKey: "secret-api-key" })),
    ],
  ])("rejects %s with the safe INVALID_URL response", async (_name, request) => {
    const fetchSource = vi.fn();
    const response = await createChapterSourceHandler({ fetchSource })(request);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      code: "INVALID_URL",
      message: "올바른 URL을 입력해 주세요.",
      retryable: false,
    });
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("rejects an oversized request body before parsing it", async () => {
    const secret = "secret-api-key".repeat(100);
    const response = await createChapterSourceHandler({ fetchSource: vi.fn() })(
      jsonRequest(JSON.stringify({ url: sourceUrl, apiKey: secret })),
    );
    const body = await response.text();

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(body)).toEqual({
      code: "SOURCE_TOO_LARGE",
      message: "원본 페이지가 허용 크기를 초과했습니다.",
      retryable: false,
    });
    expect(body).not.toContain(secret);
  });

  it.each([
    ["UNSUPPORTED_SITE", 400],
    ["SOURCE_UNREACHABLE", 502],
    ["SOURCE_TOO_LARGE", 413],
    ["EXTRACTION_FAILED", 422],
  ] as const)("maps %s to a safe public response", async (code, status) => {
    const privateDetail = `<html>upstream secret ${code}</html>`;
    const fetchSource = vi.fn().mockRejectedValue(new SourceContractError(code, privateDetail));
    const response = await createChapterSourceHandler({ fetchSource })(
      jsonRequest(JSON.stringify({ url: sourceUrl })),
    );
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(body)).toMatchObject({ code, retryable: expect.any(Boolean) });
    expect(body).not.toContain(privateDetail);
    expect(body).not.toContain("upstream secret");
  });

  it("rejects a URL when no extractor supports the fetched destination", async () => {
    const fetchSource = vi.fn().mockResolvedValue({
      ...fetched(html),
      url: "https://example.com/chapter/1",
    });
    const response = await createChapterSourceHandler({ fetchSource })(
      jsonRequest(JSON.stringify({ url: sourceUrl })),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "UNSUPPORTED_SITE" });
  });

  it("validates extracted output before returning it", async () => {
    const fetchSource = vi.fn().mockResolvedValue(fetched(html));
    const response = await createChapterSourceHandler({
      fetchSource,
      findExtractor: () => ({
        id: "broken",
        hosts: ["www.69shuba.com"],
        matches: () => true,
        normalizeUrl: (url) => url,
        extractChapter: () => ({ unsafe: html }) as never,
        extractCatalog: () => {
          throw new Error("not used");
        },
      }),
    })(jsonRequest(JSON.stringify({ url: sourceUrl })));
    const body = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(body)).toMatchObject({ code: "EXTRACTION_FAILED" });
    expect(body).not.toContain(html);
  });
});
