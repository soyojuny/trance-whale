import "client-only";

import {
  PublicErrorSchema,
  SourceContractError,
  toPublicError,
  type PublicError,
  type PublicErrorCode,
} from "../lib/errors";
import {
  CatalogSourceSchema,
  ChapterSourceSchema,
  SourceRequestSchema,
  type CatalogSource,
  type ChapterSource,
} from "../types/source";

type FetchImplementation = typeof fetch;

export type SourceClient = {
  fetchChapter(url: string, signal: AbortSignal): Promise<ChapterSource>;
  fetchCatalog(url: string, signal: AbortSignal): Promise<CatalogSource>;
};

export class SourceClientError extends SourceContractError {
  constructor(
    readonly code: PublicErrorCode,
    readonly retryable: boolean,
    message: string,
  ) {
    super(code, message);
    this.name = "SourceClientError";
  }

  toJSON(): PublicError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

function sourceError(code: Extract<PublicErrorCode, "INVALID_URL" | "SOURCE_UNREACHABLE" | "EXTRACTION_FAILED" | "OFFLINE">) {
  const error = toPublicError(new SourceContractError(code));
  return new SourceClientError(error.code, error.retryable, error.message);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw sourceError("EXTRACTION_FAILED");
  }
}

export function createSourceClient(
  fetchImpl: FetchImplementation = fetch,
  networkAvailable = () => typeof navigator === "undefined" || navigator.onLine,
): SourceClient {
  async function request<T>(
    path: "/api/source/chapter" | "/api/source/catalog",
    url: string,
    signal: AbortSignal,
    parse: (value: unknown) => { success: true; data: T } | { success: false },
  ): Promise<T> {
    const requestBody = SourceRequestSchema.safeParse({ url });
    if (!requestBody.success) throw sourceError("INVALID_URL");
    if (!networkAvailable()) throw sourceError("OFFLINE");

    let response: Response;
    try {
      response = await fetchImpl(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody.data),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw sourceError("SOURCE_UNREACHABLE");
    }

    const decoded = await decodeJson(response);
    if (!response.ok) {
      const publicError = PublicErrorSchema.safeParse(decoded);
      if (!publicError.success) throw sourceError("EXTRACTION_FAILED");
      throw new SourceClientError(
        publicError.data.code,
        publicError.data.retryable,
        publicError.data.message,
      );
    }

    const result = parse(decoded);
    if (!result.success) throw sourceError("EXTRACTION_FAILED");
    return result.data;
  }

  return {
    fetchChapter: (url, signal) => request(
      "/api/source/chapter",
      url,
      signal,
      (value) => ChapterSourceSchema.safeParse(value),
    ),
    fetchCatalog: (url, signal) => request(
      "/api/source/catalog",
      url,
      signal,
      (value) => CatalogSourceSchema.safeParse(value),
    ),
  };
}

const defaultSourceClient = createSourceClient();

export const fetchChapter = defaultSourceClient.fetchChapter;
export const fetchCatalog = defaultSourceClient.fetchCatalog;
