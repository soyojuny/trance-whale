import "server-only";

import { SourceRequestSchema } from "../../../../types/source";
import {
  PublicErrorSchema,
  SourceContractError,
  toPublicError,
  type PublicErrorCode,
} from "../../../../lib/errors";
import {
  loadChapterSource,
  type ChapterSourceDependencies,
} from "../../../../lib/source/chapter-source.server";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 1_024;
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;
const STATUS_BY_ERROR: Partial<Record<PublicErrorCode, number>> = {
  INVALID_URL: 400,
  UNSUPPORTED_SITE: 400,
  SOURCE_BLOCKED: 403,
  SOURCE_UNREACHABLE: 502,
  SOURCE_TOO_LARGE: 413,
  EXTRACTION_FAILED: 422,
};

function errorResponse(error: unknown): Response {
  const publicError = PublicErrorSchema.parse(toPublicError(error));
  const status = STATUS_BY_ERROR[publicError.code] ?? 500;
  return Response.json(publicError, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readLimitedRequest(request: Request): Promise<string> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_REQUEST_BYTES) {
    throw new SourceContractError("SOURCE_TOO_LARGE", "Request body exceeds byte limit");
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new SourceContractError("SOURCE_TOO_LARGE", "Request body exceeds byte limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof SourceContractError) throw error;
    throw new SourceContractError("INVALID_URL", "Request body is not valid UTF-8");
  } finally {
    reader.releaseLock();
  }
}

export function createChapterSourceHandler(dependencies: ChapterSourceDependencies = {}) {
  return async function chapterSourceHandler(request: Request): Promise<Response> {
    try {
      const contentType = request.headers.get("content-type") ?? "";
      if (!JSON_CONTENT_TYPE.test(contentType)) {
        throw new SourceContractError("INVALID_URL", "Request content type must be JSON");
      }

      const text = await readLimitedRequest(request);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new SourceContractError("INVALID_URL", "Request body is not valid JSON");
      }

      const requestData = SourceRequestSchema.safeParse(body);
      if (!requestData.success) {
        throw new SourceContractError("INVALID_URL", "Request body failed validation");
      }

      const chapter = await loadChapterSource(requestData.data.url, dependencies);
      return Response.json(chapter, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const POST = createChapterSourceHandler();
