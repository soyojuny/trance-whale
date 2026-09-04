import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SourceContractError } from "../../src/lib/errors";
import {
  fetchSourceHtml,
  type SourceFetch,
  type SourceUrlValidator,
} from "../../src/lib/source/fetch-source.server";

const startUrl = "https://www.69shuba.com/chapter/1";

function validator(): ReturnType<typeof vi.fn<SourceUrlValidator>> {
  return vi.fn<SourceUrlValidator>(async (input) => new URL(input));
}

function htmlResponse(body: BodyInit, headers: HeadersInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

async function expectCode(promise: Promise<unknown>, code: SourceContractError["code"]) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("fetchSourceHtml", () => {
  it("validates and fetches HTML without forwarding credentials or custom headers", async () => {
    const validateUrl = validator();
    const fetchImpl = vi.fn<SourceFetch>().mockResolvedValue(htmlResponse("<p>chapter</p>"));

    const result = await fetchSourceHtml(startUrl, { validateUrl, fetchImpl });

    expect(result).toEqual({
      url: startUrl,
      html: "<p>chapter</p>",
      contentType: "text/html; charset=utf-8",
    });
    expect(validateUrl).toHaveBeenCalledWith(startUrl);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(new Headers(init?.headers).has("cookie")).toBe(false);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
  });

  it("manually follows a relative redirect and validates every destination", async () => {
    const validateUrl = validator();
    const fetchImpl = vi
      .fn<SourceFetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/chapter/2" } }),
      )
      .mockResolvedValueOnce(htmlResponse("next"));

    const result = await fetchSourceHtml(startUrl, { validateUrl, fetchImpl });

    expect(result.url).toBe("https://www.69shuba.com/chapter/2");
    expect(validateUrl).toHaveBeenNthCalledWith(1, startUrl);
    expect(validateUrl).toHaveBeenNthCalledWith(
      2,
      "https://www.69shuba.com/chapter/2",
    );
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("rejects redirect loops, redirect overflow, and destinations that fail validation", async () => {
    const loopFetch = vi.fn<SourceFetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: startUrl } }),
    );
    await expectCode(
      fetchSourceHtml(startUrl, { validateUrl: validator(), fetchImpl: loopFetch }),
      "SOURCE_UNREACHABLE",
    );

    const redirectFetch = vi.fn<SourceFetch>().mockImplementation(async (input) => {
      const number = Number(new URL(String(input)).pathname.split("/").at(-1));
      return new Response(null, {
        status: 302,
        headers: { location: `/chapter/${number + 1}` },
      });
    });
    await expectCode(
      fetchSourceHtml(startUrl, {
        validateUrl: validator(),
        fetchImpl: redirectFetch,
        maxRedirects: 2,
      }),
      "SOURCE_UNREACHABLE",
    );
    expect(redirectFetch).toHaveBeenCalledTimes(3);

    const blockedValidator = validator();
    blockedValidator.mockResolvedValueOnce(new URL(startUrl));
    blockedValidator.mockRejectedValueOnce(
      new SourceContractError("SOURCE_BLOCKED", "private redirect detail"),
    );
    const oneRedirect = vi.fn<SourceFetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "/blocked" } }),
    );
    await expectCode(
      fetchSourceHtml(startUrl, {
        validateUrl: blockedValidator,
        fetchImpl: oneRedirect,
      }),
      "SOURCE_BLOCKED",
    );
  });

  it("applies one timeout to the complete redirect and body-reading operation", async () => {
    const fetchImpl = vi.fn<SourceFetch>().mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("secret timeout")));
      }),
    );

    await expectCode(
      fetchSourceHtml(startUrl, {
        validateUrl: validator(),
        fetchImpl,
        timeoutMs: 5,
      }),
      "SOURCE_UNREACHABLE",
    );
  });

  it("rejects non-HTML responses without reading or exposing their body", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("upstream secret"));
      },
      cancel,
    });
    const fetchImpl = vi.fn<SourceFetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await fetchSourceHtml(startUrl, {
      validateUrl: validator(),
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "EXTRACTION_FAILED" });
    expect(String(error)).not.toContain("upstream secret");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces the byte limit while streaming even without content-length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<SourceFetch>().mockResolvedValue(htmlResponse(body));

    await expectCode(
      fetchSourceHtml(startUrl, {
        validateUrl: validator(),
        fetchImpl,
        maxBytes: 5,
      }),
      "SOURCE_TOO_LARGE",
    );
  });

  it("decodes the declared charset and preserves the content type", async () => {
    const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]);
    const fetchImpl = vi.fn<SourceFetch>().mockResolvedValue(
      htmlResponse(bytes, { "content-type": "text/html; charset=windows-1252" }),
    );

    const result = await fetchSourceHtml(startUrl, { validateUrl: validator(), fetchImpl });

    expect(result.html).toBe("café");
    expect(result.contentType).toBe("text/html; charset=windows-1252");
  });
});
