import "client-only";

import { SourceContractError, type PublicErrorCode } from "../lib/errors";
import type { TranslationChunk } from "../lib/translation/chunk";
import { TRANSLATION_MODELS } from "../lib/translation/models";
import { buildTranslationPrompt } from "../lib/translation/prompt";
import { validateTranslationOutput } from "../lib/translation/validate-output";
import type { TranslationParagraph } from "../types/translation";

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
};

type SafeGeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
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

async function sendGenerateContent(
  request: CommonRequest,
  body: Record<string, unknown>,
): Promise<SafeGeminiResponse> {
  assertAllowedModel(request.modelId);
  const networkAvailable = request.networkAvailable
    ?? (() => typeof navigator === "undefined" || navigator.onLine);
  if (!networkAvailable()) throw new GeminiClientError("OFFLINE", true);
  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;

  try {
    response = await fetchImpl(
      `${GEMINI_API_ORIGIN}/${GEMINI_API_VERSION}/models/${request.modelId}:generateContent`,
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

function responseText(response: SafeGeminiResponse): string {
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new GeminiClientError("TRANSLATION_FAILED", false);
  return text;
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
  const response = await sendGenerateContent(request, {
    systemInstruction: { parts: [{ text: buildTranslationPrompt(request.userPrompt) }] },
    contents: [
      {
        role: "user",
        parts: [{ text: JSON.stringify({ paragraphs: request.chunk.paragraphs }) }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        required: ["translations"],
        properties: {
          translations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              required: ["id", "text"],
              properties: { id: { type: "STRING" }, text: { type: "STRING" } },
            },
          },
        },
      },
    },
  });

  return validateTranslationOutput(responseText(response), request.chunk);
}
