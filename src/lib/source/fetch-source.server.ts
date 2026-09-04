import "server-only";

import { SourceContractError } from "../errors";
import { validateSourceUrl } from "./validate-url.server";

export type SourceUrlValidator = (input: string) => Promise<URL>;
export type SourceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FetchSourceDependencies = {
  validateUrl?: SourceUrlValidator;
  fetchImpl?: SourceFetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

export type FetchedSourceHtml = {
  url: string;
  html: string;
  contentType: string;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function sourceError(code: SourceContractError["code"], message: string) {
  return new SourceContractError(code, message);
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is already being rejected, so cancellation errors are irrelevant.
  }
}

function parseContentType(response: Response): { value: string; charset: string } {
  const value = response.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = value.split(";");

  if (!HTML_MEDIA_TYPES.has(mediaType.trim().toLowerCase())) {
    throw sourceError("EXTRACTION_FAILED", "Source response is not HTML");
  }

  const charsetParameter = parameters.find((parameter) =>
    parameter.trim().toLowerCase().startsWith("charset="),
  );
  const charset = charsetParameter
    ? charsetParameter.split("=", 2)[1].trim().replace(/^['"]|['"]$/g, "")
    : "utf-8";

  return { value, charset };
}

async function readLimitedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    await discardBody(response);
    throw sourceError("SOURCE_TOO_LARGE", "Source response exceeds byte limit");
  }

  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw sourceError("SOURCE_TOO_LARGE", "Source response exceeds byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeHtml(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes);
  } catch {
    throw sourceError("EXTRACTION_FAILED", "Source character encoding is invalid");
  }
}

export async function fetchSourceHtml(
  input: string,
  dependencies: FetchSourceDependencies = {},
): Promise<FetchedSourceHtml> {
  const validateUrl = dependencies.validateUrl ?? validateSourceUrl;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = dependencies.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = dependencies.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const visited = new Set<string>();

  try {
    let currentUrl = await validateUrl(input);

    for (let redirectCount = 0; ; redirectCount += 1) {
      if (visited.has(currentUrl.href)) {
        throw sourceError("SOURCE_UNREACHABLE", "Source redirect loop detected");
      }
      visited.add(currentUrl.href);

      const response = await fetchImpl(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "text/html, application/xhtml+xml" },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        await discardBody(response);
        if (redirectCount >= maxRedirects) {
          throw sourceError("SOURCE_UNREACHABLE", "Source redirect limit exceeded");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw sourceError("SOURCE_UNREACHABLE", "Source redirect has no location");
        }
        currentUrl = await validateUrl(new URL(location, currentUrl).href);
        continue;
      }

      if (!response.ok) {
        await discardBody(response);
        throw sourceError("SOURCE_UNREACHABLE", "Source returned an unsuccessful status");
      }

      let contentType: { value: string; charset: string };
      try {
        contentType = parseContentType(response);
      } catch (error) {
        await discardBody(response);
        throw error;
      }
      const bytes = await readLimitedBody(response, maxBytes);

      return {
        url: currentUrl.href,
        html: decodeHtml(bytes, contentType.charset),
        contentType: contentType.value,
      };
    }
  } catch (error) {
    if (error instanceof SourceContractError) throw error;
    throw sourceError("SOURCE_UNREACHABLE", "Source request failed");
  } finally {
    clearTimeout(timeout);
  }
}
