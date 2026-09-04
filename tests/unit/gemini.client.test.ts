import { describe, expect, it, vi } from "vitest";

import { TRANSLATION_MODELS } from "../../src/lib/translation/models";
import { toPublicError } from "../../src/lib/errors";
import {
  GeminiClientError,
  translateChunk,
  validateApiKey,
} from "../../src/services/gemini.client";

const API_KEY = "test-secret-key";
const modelId = TRANSLATION_MODELS.fast.modelId;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Gemini client", () => {
  it("reports OFFLINE without starting a new translation request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const error = await validateApiKey({
      apiKey: API_KEY,
      modelId,
      signal: new AbortController().signal,
      fetchImpl,
      networkAvailable: () => false,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "OFFLINE", retryable: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates an API key directly with Gemini using the selected model and signal", async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    );

    await expect(validateApiKey({ apiKey: API_KEY, modelId, signal, fetchImpl })).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`);
    expect(String(url)).not.toContain(API_KEY);
    expect(init?.signal).toBe(signal);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(API_KEY);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contents: [{ role: "user", parts: [{ text: expect.any(String) }] }],
    });
  });

  it("requests structured output and validates the translated paragraphs", async () => {
    const signal = new AbortController().signal;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ translations: [{ id: "p1", text: "안녕" }] }) }] },
        }],
      }),
    );
    const chunk = { chunkId: "chunk-0", paragraphs: [{ id: "p1", text: "你好" }] };

    await expect(
      translateChunk({ apiKey: API_KEY, modelId, userPrompt: "이름을 유지한다.", chunk, signal, fetchImpl }),
    ).resolves.toEqual([{ id: "p1", text: "안녕" }]);

    const [url, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(String(url)).not.toContain("/api/");
    expect(body.systemInstruction.parts[0].text).toContain("이름을 유지한다.");
    expect(body.contents[0].parts[0].text).toBe(JSON.stringify({ paragraphs: chunk.paragraphs }));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT" },
    });
  });

  it.each([
    [401, "INVALID_API_KEY", false],
    [403, "MODEL_UNAVAILABLE", false],
    [404, "MODEL_UNAVAILABLE", false],
    [429, "QUOTA_EXCEEDED", true],
    [500, "TRANSLATION_FAILED", true],
    [503, "TRANSLATION_FAILED", true],
    [418, "TRANSLATION_FAILED", false],
  ] as const)("classifies HTTP %s without exposing response content", async (status, code, retryable) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: { message: `${API_KEY} upstream detail` } }, status),
    );

    const error = await validateApiKey({ apiKey: API_KEY, modelId, signal: new AbortController().signal, fetchImpl })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GeminiClientError);
    expect(error).toMatchObject({ code, retryable });
    expect(toPublicError(error)).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain(API_KEY);
    expect((error as Error).message).not.toContain("upstream detail");
  });

  it("classifies a safety-blocked response without exposing its raw content", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ promptFeedback: { blockReason: "SAFETY" }, secret: API_KEY }),
    );

    const error = await validateApiKey({ apiKey: API_KEY, modelId, signal: new AbortController().signal, fetchImpl })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "TRANSLATION_BLOCKED", retryable: false });
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("classifies network errors but preserves abort errors unchanged", async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(`failed ${API_KEY}`));
    const networkError = await validateApiKey({
      apiKey: API_KEY, modelId, signal: new AbortController().signal, fetchImpl: networkFetch,
    }).catch((caught: unknown) => caught);
    expect(networkError).toMatchObject({ code: "TRANSLATION_FAILED", retryable: true });
    expect(JSON.stringify(networkError)).not.toContain(API_KEY);

    const abortError = new DOMException("The operation was aborted", "AbortError");
    const abortFetch = vi.fn<typeof fetch>().mockRejectedValue(abortError);
    await expect(validateApiKey({
      apiKey: API_KEY, modelId, signal: new AbortController().signal, fetchImpl: abortFetch,
    })).rejects.toBe(abortError);
  });

  it("rejects model IDs outside the central catalog before fetching", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await validateApiKey({
      apiKey: API_KEY,
      modelId: "gemini-unknown",
      signal: new AbortController().signal,
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "MODEL_UNAVAILABLE", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
