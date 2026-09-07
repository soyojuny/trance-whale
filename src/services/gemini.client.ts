import "client-only";

import { SourceContractError, TranslationOutputError, type PublicErrorCode } from "../lib/errors";
import type { TranslationChunk } from "../lib/translation/chunk";
import {
  reportTranslationDiagnostic,
  type TranslationDiagnosticLogger,
} from "../lib/translation/diagnostics.client";
import { TRANSLATION_MODELS } from "../lib/translation/models";
import {
  createTranslationJsonParser,
  geminiTextParts,
  readGeminiSse,
} from "../lib/translation/gemini-stream.client";
import { buildTranslationPrompt } from "../lib/translation/prompt";
import { validateTranslationOutput } from "../lib/translation/validate-output";
import { TranslationParagraphSchema, type TranslationParagraph } from "../types/translation";

const GEMINI_API_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_API_VERSION = "v1beta";

type FetchImplementation = typeof fetch;

type CommonRequest = {
  apiKey: string;
  modelId: string;
  signal: AbortSignal;
  fetchImpl?: FetchImplementation;
  networkAvailable?: () => boolean;
};

type TranslateChunkRequest = CommonRequest & {
  chunk: TranslationChunk;
  userPrompt: string;
  runId?: string;
  attempt?: number;
  diagnosticLogger?: TranslationDiagnosticLogger;
  onProgress?: (paragraph: TranslationParagraph) => void;
};

type SafeGeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
  responseId?: unknown;
  modelVersion?: unknown;
  usageMetadata?: {
    promptTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
    totalTokenCount?: unknown;
  };
};

const ERROR_MESSAGES: Record<
  Extract<
    PublicErrorCode,
    | "INVALID_API_KEY"
    | "MODEL_UNAVAILABLE"
    | "QUOTA_EXCEEDED"
    | "TRANSLATION_BLOCKED"
    | "TRANSLATION_FAILED"
    | "OFFLINE"
  >,
  string
> = {
  INVALID_API_KEY: "Gemini API Key를 확인해 주세요.",
  MODEL_UNAVAILABLE: "선택한 번역 모델을 사용할 수 없습니다.",
  QUOTA_EXCEEDED: "Gemini API 사용량이 소진되었습니다. 사용량을 확인한 뒤 다시 시도해 주세요.",
  TRANSLATION_BLOCKED: "안전 정책으로 번역할 수 없습니다.",
  TRANSLATION_FAILED: "번역을 완료할 수 없습니다.",
  OFFLINE: "새 콘텐츠를 열려면 네트워크 연결이 필요합니다.",
};

export class GeminiClientError extends SourceContractError {
  constructor(
    readonly code: keyof typeof ERROR_MESSAGES,
    readonly retryable: boolean,
  ) {
    super(code, ERROR_MESSAGES[code]);
    this.name = "GeminiClientError";
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

function assertAllowedModel(modelId: string): void {
  const allowedModelIds = Object.values(TRANSLATION_MODELS).map((model) => model.modelId);
  if (!allowedModelIds.includes(modelId as (typeof allowedModelIds)[number])) {
    throw new GeminiClientError("MODEL_UNAVAILABLE", false);
  }
}

function classifyHttpError(status: number): GeminiClientError {
  if (status === 401) return new GeminiClientError("INVALID_API_KEY", false);
  if (status === 403 || status === 404) return new GeminiClientError("MODEL_UNAVAILABLE", false);
  if (status === 429) return new GeminiClientError("QUOTA_EXCEEDED", false);
  return new GeminiClientError("TRANSLATION_FAILED", status >= 500);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isBlocked(response: SafeGeminiResponse): boolean {
  if (response.promptFeedback?.blockReason === "SAFETY") return true;
  return response.candidates?.some((candidate) => candidate.finishReason === "SAFETY") ?? false;
}

async function sendGeminiRequest(
  request: CommonRequest,
  body: Record<string, unknown>,
  method: "generateContent" | "streamGenerateContent",
): Promise<Response> {
  assertAllowedModel(request.modelId);
  const networkAvailable = request.networkAvailable
    ?? (() => typeof navigator === "undefined" || navigator.onLine);
  if (!networkAvailable()) throw new GeminiClientError("OFFLINE", true);
  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(
      `${GEMINI_API_ORIGIN}/${GEMINI_API_VERSION}/models/${request.modelId}:${method}${method === "streamGenerateContent" ? "?alt=sse" : ""}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": request.apiKey,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      },
    );
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new GeminiClientError("TRANSLATION_FAILED", true);
  }

  if (!response.ok) throw classifyHttpError(response.status);
  return response;
}

async function sendGenerateContent(
  request: CommonRequest,
  body: Record<string, unknown>,
): Promise<SafeGeminiResponse> {
  const response = await sendGeminiRequest(request, body, "generateContent");
  let decoded: unknown;
  try {
    decoded = await response.json();
  } catch {
    throw new GeminiClientError("TRANSLATION_FAILED", false);
  }

  if (typeof decoded !== "object" || decoded === null) {
    throw new GeminiClientError("TRANSLATION_FAILED", false);
  }

  const safeResponse = decoded as SafeGeminiResponse;
  if (isBlocked(safeResponse)) throw new GeminiClientError("TRANSLATION_BLOCKED", false);
  return safeResponse;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function reportGeminiResponse(request: TranslateChunkRequest, response: SafeGeminiResponse): void {
  if (!request.diagnosticLogger) return;

  const candidate = response.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const textParts = parts.filter((part) => typeof part.text === "string");

  reportTranslationDiagnostic(request.diagnosticLogger, {
    event: "gemini_response",
    runId: request.runId ?? "direct-translation",
    chunkId: request.chunk.chunkId,
    attempt: request.attempt ?? 1,
    responseId: optionalString(response.responseId),
    modelVersion: optionalString(response.modelVersion),
    finishReason: optionalString(candidate?.finishReason),
    candidateCount: response.candidates?.length ?? 0,
    contentPartCount: parts.length,
    textPartCount: textParts.length,
    textLength: textParts.reduce((length, part) => length + (part.text as string).length, 0),
    promptTokenCount: optionalNumber(response.usageMetadata?.promptTokenCount),
    candidatesTokenCount: optionalNumber(response.usageMetadata?.candidatesTokenCount),
    thoughtsTokenCount: optionalNumber(response.usageMetadata?.thoughtsTokenCount),
    totalTokenCount: optionalNumber(response.usageMetadata?.totalTokenCount),
  });
}

export async function validateApiKey(request: CommonRequest): Promise<void> {
  await sendGenerateContent(request, {
    contents: [{ role: "user", parts: [{ text: "Reply with ok." }] }],
    generationConfig: { maxOutputTokens: 2 },
  });
}

export async function translateChunk(
  request: TranslateChunkRequest,
): Promise<TranslationParagraph[]> {
  const response = await sendGeminiRequest(request, {
    systemInstruction: { parts: [{ text: buildTranslationPrompt(request.userPrompt) }] },
    contents: [
      {
        role: "user",
        parts: [{ text: JSON.stringify({ paragraphs: request.chunk.paragraphs }) }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        required: ["translations"],
        additionalProperties: false,
        properties: {
          translations: {
            type: "array",
            minItems: request.chunk.paragraphs.length,
            maxItems: request.chunk.paragraphs.length,
            prefixItems: request.chunk.paragraphs.map(({ id }) => ({
              type: "object",
              required: ["id", "text"],
              additionalProperties: false,
              properties: {
                id: { type: "string", enum: [id] },
                text: {
                  type: "string",
                  // Gemini may ignore minLength; validateTranslationOutput enforces it.
                  minLength: 1,
                  description: "Non-empty translated paragraph text.",
                },
              },
            })),
          },
        },
      },
    },
  }, "streamGenerateContent");

  if (!response.body) throw new GeminiClientError("TRANSLATION_FAILED", false);
  const parser = createTranslationJsonParser();
  const emitted: TranslationParagraph[] = [];
  const emittedIds = new Set<string>();
  const requestedIds = new Set(request.chunk.paragraphs.map((paragraph) => paragraph.id));

  try {
    for await (const event of readGeminiSse(response.body)) {
      if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const textParts = geminiTextParts(event);
      const safeResponse = event as SafeGeminiResponse;
      reportGeminiResponse(request, safeResponse);
      if (isBlocked(safeResponse)) throw new GeminiClientError("TRANSLATION_BLOCKED", false);

      for (const text of textParts) {
        for (const candidate of parser.push(text)) {
          if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const parsed = TranslationParagraphSchema.safeParse(candidate);
          if (!parsed.success) throw new TranslationOutputError("INVALID_SCHEMA");
          const paragraph = parsed.data;
          const rawId = (candidate as { id: string }).id;
          if (rawId !== paragraph.id || !requestedIds.has(paragraph.id)) {
            throw new TranslationOutputError("UNEXPECTED_ID");
          }
          if (emittedIds.has(paragraph.id)) throw new TranslationOutputError("DUPLICATE_ID");
          if (paragraph.id !== request.chunk.paragraphs[emitted.length]?.id) {
            throw new TranslationOutputError("OUT_OF_ORDER");
          }
          emitted.push(paragraph);
          emittedIds.add(paragraph.id);
          request.onProgress?.({ ...paragraph });
        }
      }
    }
  } catch (error) {
    if (isAbortError(error) || request.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (error instanceof TypeError) throw new GeminiClientError("TRANSLATION_FAILED", true);
    throw error;
  } finally {
    // Release the connection after early contract failure or cancellation as well.
    await response.body.cancel().catch(() => undefined);
  }

  if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
  const translations = validateTranslationOutput(parser.finish(), request.chunk);
  if (translations.length !== emitted.length || translations.some((paragraph, index) =>
    paragraph.id !== emitted[index].id || paragraph.text !== emitted[index].text
  )) {
    throw new TranslationOutputError("INVALID_SCHEMA");
  }
  return translations;
}
