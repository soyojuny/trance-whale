import { describe, expect, it, vi } from "vitest";

import { TRANSLATION_MODELS } from "../../src/lib/translation/models";
import { toPublicError } from "../../src/lib/errors";
import type { TranslationDiagnosticEvent } from "../../src/lib/translation/diagnostics.client";
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

function sseResponse(...events: unknown[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function textEvent(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

describe("Gemini client", () => {
  const streamingRequest = () => ({
    apiKey: API_KEY,
    modelId,
    userPrompt: "",
    isChapterStart: true,
    chunk: { chunkId: "chunk-0", paragraphs: [
      { id: "p1", text: "source-one" },
      { id: "p2", text: "source-two" },
    ] },
    signal: new AbortController().signal,
  });

  it.each([true, false])("scopes opening instructions to the chapter start: %s", async (isChapterStart) => {
    const userPrompt = "최상단에 **제N장 제목(한자)**으로 시작하여 즉시 본문을 출력한다. 이름은 음역한다.";
    const input = streamingRequest();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(textEvent(JSON.stringify({
      translations: input.chunk.paragraphs,
    }))));

    await translateChunk({ ...input, userPrompt, isChapterStart, fetchImpl });

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    const prompt = body.systemInstruction.parts[0].text;
    expect(prompt).toContain(userPrompt);
    expect(prompt).toContain(isChapterStart
      ? "이 요청은 장의 첫 문단을 포함한다."
      : "이 요청은 같은 장의 이어지는 본문이며 장의 시작이 아니다.");
    expect(prompt).toContain("원문에 실제로 있는 중간 제목은 번역하여 보존한다.");
    if (!isChapterStart) {
      expect(prompt).toContain("사용자 지시에 최상단 제목이나 시작 문구가 있더라도 이 요청에서는 추가하거나 반복하지 않는다.");
    }
  });

  it("delivers a complete first paragraph while the next paragraph is still streaming", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const onProgress = vi.fn();
    const result = translateChunk({ ...streamingRequest(), fetchImpl, onProgress });
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify(textEvent('{"translations":[{"id":"p1","text":"one"},{"id":"p2","text":"tw'))}\n\n`));
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledExactlyOnceWith({ id: "p1", text: "one" }));
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify(textEvent('o"}]}'))}\n\n`));
    streamController.close();
    await expect(result).resolves.toEqual([{ id: "p1", text: "one" }, { id: "p2", text: "two" }]);
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it.each([
    [[{ id: "p2", text: "two" }, { id: "p1", text: "one" }], "OUT_OF_ORDER", 0],
    [[{ id: "p1", text: "one" }, { id: "p1", text: "duplicate" }], "DUPLICATE_ID", 1],
    [[{ id: "other", text: "other" }], "UNEXPECTED_ID", 0],
    [[{ id: "p1:", text: "suffix" }], "UNEXPECTED_ID", 0],
    [[{ id: "p1", text: "one" }], "MISSING_ID", 1],
    [[{ id: "p1", text: " " }], "INVALID_SCHEMA", 0],
  ] as const)("rejects invalid streamed paragraph contracts before exposing the invalid object", async (translations, reason, count) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(textEvent(JSON.stringify({ translations }))));
    const onProgress = vi.fn();
    await expect(translateChunk({ ...streamingRequest(), fetchImpl, onProgress })).rejects.toMatchObject({ reason });
    expect(onProgress).toHaveBeenCalledTimes(count);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a final response that replaces an already emitted translation", async () => {
    const text = '{"translations":[{"id":"p1","text":"one"},{"id":"p2","text":"two"}],"translations":[{"id":"p1","text":"changed"},{"id":"p2","text":"two"}]}';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(textEvent(text)));
    await expect(translateChunk({ ...streamingRequest(), fetchImpl })).rejects.toMatchObject({ reason: "INVALID_SCHEMA" });
  });

  it("does not allow a progress callback to mutate the validated internal result", async () => {
    const translations = [{ id: "p1", text: "one" }, { id: "p2", text: "two" }];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(textEvent(JSON.stringify({ translations }))));
    await expect(translateChunk({
      ...streamingRequest(), fetchImpl,
      onProgress: (paragraph) => { paragraph.text = "mutated"; },
    })).resolves.toEqual(translations);
  });

  it.each(["disconnect", "abort"] as const)("preserves delivered paragraphs after %s", async (failure) => {
    const abortController = new AbortController();
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const onProgress = vi.fn();
    const result = translateChunk({ ...streamingRequest(), signal: abortController.signal, fetchImpl, onProgress })
      .catch((error: unknown) => error);
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify(textEvent('{"translations":[{"id":"p1","text":"one"},'))}\n\n`));
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledTimes(1));
    if (failure === "abort") abortController.abort();
    streamController.error(failure === "abort"
      ? new DOMException(API_KEY, "AbortError")
      : new TypeError(API_KEY));
    const error = await result;
    expect(error).toMatchObject(failure === "abort"
      ? { name: "AbortError" }
      : { code: "TRANSLATION_FAILED", retryable: true });
    expect(String(error)).not.toContain(API_KEY);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({ id: "p1", text: "one" });
  });

  it("rejects a truncated final object without delivering it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(textEvent('{"translations":[{"id":"p1","text":"one"},{"id":"p2","text":"sec')));
    const onProgress = vi.fn();
    await expect(translateChunk({ ...streamingRequest(), fetchImpl, onProgress })).rejects.toMatchObject({ reason: "MALFORMED_JSON" });
    expect(onProgress).toHaveBeenCalledExactlyOnceWith({ id: "p1", text: "one" });
  });

  it("rejects safety-blocked streamed text before progress and retains metadata-only diagnostics", async () => {
    const diagnostics: TranslationDiagnosticEvent[] = [];
    const onProgress = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(
      { usageMetadata: { totalTokenCount: 3 } },
      { candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: API_KEY }] } }] },
    ));
    const error = await translateChunk({ ...streamingRequest(), fetchImpl, onProgress, diagnosticLogger: (event) => diagnostics.push(event) })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "TRANSLATION_BLOCKED", retryable: false });
    expect(onProgress).not.toHaveBeenCalled();
    expect(diagnostics[0]).toMatchObject({ totalTokenCount: 3 });
    expect(JSON.stringify(diagnostics)).not.toContain(API_KEY);
  });

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
      sseResponse({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ translations: [{ id: "p1", text: "안녕" }] }) }] },
        }],
      }),
    );
    const chunk = { chunkId: "chunk-0", paragraphs: [{ id: "p1", text: "你好" }] };

    await expect(
      translateChunk({ apiKey: API_KEY, modelId, userPrompt: "이름을 유지한다.", isChapterStart: true, chunk, signal, fetchImpl }),
    ).resolves.toEqual([{ id: "p1", text: "안녕" }]);

    const [url, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse`);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBe(signal);
    expect(String(url)).not.toContain("/api/");
    expect(body.systemInstruction.parts[0].text).toContain("이름을 유지한다.");
    expect(body.contents[0].parts[0].text).toBe(JSON.stringify({ paragraphs: chunk.paragraphs }));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      responseJsonSchema: { type: "object" },
    });
  });

  it.each([["p1"], ["p3", "p1", "p2"]])(
    "constrains structured output to the requested paragraph count and ID order: %j",
    async (...ids) => {
      const paragraphs = ids.map((id) => ({ id, text: "source fixture" }));
      const translations = ids.map((id) => ({ id, text: "translation fixture" }));
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ translations }) }] } }],
      }));

      await expect(translateChunk({
        apiKey: API_KEY,
        modelId,
        userPrompt: "",
        isChapterStart: true,
        chunk: { chunkId: "chunk-0", paragraphs },
        signal: new AbortController().signal,
        fetchImpl,
      })).resolves.toEqual(translations);

      const [url, init] = fetchImpl.mock.calls[0];
      const body = JSON.parse(String(init?.body));
      expect(body.generationConfig.responseSchema).toBeUndefined();
      expect(body.generationConfig.responseJsonSchema).toEqual({
        type: "object",
        required: ["translations"],
        additionalProperties: false,
        properties: {
          translations: {
            type: "array",
            minItems: ids.length,
            maxItems: ids.length,
            prefixItems: ids.map((id) => ({
              type: "object",
              required: ["id", "text"],
              additionalProperties: false,
              properties: {
                id: { type: "string", enum: [id] },
                text: {
                  type: "string",
                  minLength: 1,
                  description: "Non-empty translated paragraph text.",
                },
              },
            })),
          },
        },
      });
      expect(String(url)).not.toContain(API_KEY);
      expect(String(init?.body)).not.toContain(API_KEY);
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(API_KEY);
      expect(JSON.stringify(init?.headers)).not.toContain("source fixture");
      expect(JSON.stringify(init?.headers)).not.toContain("translation fixture");
    },
  );

  it("imports the Gemini client without server build variables in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PWA_BUILD_ID", undefined);

    try {
      const { translateChunk: translateInProduction } = await import("../../src/services/gemini.client");
      const input = streamingRequest();
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse(textEvent(JSON.stringify({
        translations: input.chunk.paragraphs,
      }))));
      await expect(translateInProduction({ ...input, isChapterStart: false, fetchImpl }))
        .resolves.toEqual(input.chunk.paragraphs);
      const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
      expect(body.systemInstruction.parts[0].text).toContain("이 요청은 같은 장의 이어지는 본문이며 장의 시작이 아니다.");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("records sanitized Gemini metadata and the output-contract reason", async () => {
    const diagnostics: TranslationDiagnosticEvent[] = [];
    const rawTranslation = JSON.stringify({
      translations: [{ id: "unexpected", text: `translation containing ${API_KEY}` }],
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sseResponse({
      candidates: [{
        content: { parts: [{ text: rawTranslation }] },
        finishReason: "STOP",
      }],
      responseId: "gemini-response-1",
      modelVersion: "gemini-3.5-flash-lite",
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 3,
        totalTokenCount: 33,
      },
    }));

    await expect(translateChunk({
      apiKey: API_KEY,
      modelId,
      userPrompt: "",
      isChapterStart: false,
      chunk: { chunkId: "chunk-7", paragraphs: [{ id: "p1", text: "비밀 원문" }] },
      signal: new AbortController().signal,
      runId: "translation-run-1",
      attempt: 1,
      diagnosticLogger: (event) => diagnostics.push(event),
      fetchImpl,
    })).rejects.toMatchObject({ reason: "UNEXPECTED_ID" });

    expect(diagnostics).toEqual([{
      event: "gemini_response",
      runId: "translation-run-1",
      chunkId: "chunk-7",
      attempt: 1,
      responseId: "gemini-response-1",
      modelVersion: "gemini-3.5-flash-lite",
      finishReason: "STOP",
      candidateCount: 1,
      contentPartCount: 1,
      textPartCount: 1,
      textLength: rawTranslation.length,
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 3,
      totalTokenCount: 33,
    }]);
    expect(JSON.stringify(diagnostics)).not.toContain(API_KEY);
    expect(JSON.stringify(diagnostics)).not.toContain("비밀 원문");
  });

  it.each([
    [401, "INVALID_API_KEY", false],
    [403, "MODEL_UNAVAILABLE", false],
    [404, "MODEL_UNAVAILABLE", false],
    [429, "QUOTA_EXCEEDED", false],
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

  it("reports Gemini usage exhaustion without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 429));

    const error = await validateApiKey({
      apiKey: API_KEY,
      modelId,
      signal: new AbortController().signal,
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "QUOTA_EXCEEDED",
      message: "Gemini API 사용량이 소진되었습니다. 사용량을 확인한 뒤 다시 시도해 주세요.",
      retryable: false,
    });
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
