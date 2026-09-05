import { z } from "zod";

export const PUBLIC_ERROR_CODES = [
  "INVALID_URL",
  "UNSUPPORTED_SITE",
  "SOURCE_BLOCKED",
  "SOURCE_UNREACHABLE",
  "SOURCE_TOO_LARGE",
  "EXTRACTION_FAILED",
  "INVALID_EPUB",
  "EPUB_TOO_LARGE",
  "EPUB_UNSUPPORTED",
  "INVALID_API_KEY",
  "MODEL_UNAVAILABLE",
  "QUOTA_EXCEEDED",
  "TRANSLATION_BLOCKED",
  "TRANSLATION_FAILED",
  "STORAGE_FULL",
  "OFFLINE",
] as const;

export const PublicErrorCodeSchema = z.enum(PUBLIC_ERROR_CODES);
export type PublicErrorCode = z.infer<typeof PublicErrorCodeSchema>;

export const PublicErrorSchema = z
  .object({
    code: PublicErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  })
  .strict();

export type PublicError = z.infer<typeof PublicErrorSchema>;

const PUBLIC_ERRORS = {
  INVALID_URL: { message: "올바른 URL을 입력해 주세요.", retryable: false },
  UNSUPPORTED_SITE: { message: "지원하지 않는 사이트입니다.", retryable: false },
  SOURCE_BLOCKED: { message: "안전하지 않은 원본 요청이 차단되었습니다.", retryable: false },
  SOURCE_UNREACHABLE: { message: "원본 사이트에 연결할 수 없습니다.", retryable: true },
  SOURCE_TOO_LARGE: { message: "원본 페이지가 허용 크기를 초과했습니다.", retryable: false },
  EXTRACTION_FAILED: { message: "본문 정보를 추출할 수 없습니다.", retryable: false },
  INVALID_EPUB: { message: "EPUB 파일 형식을 확인해 주세요.", retryable: false },
  EPUB_TOO_LARGE: { message: "EPUB 파일이 허용 한도를 초과했습니다.", retryable: false },
  EPUB_UNSUPPORTED: { message: "지원하지 않는 EPUB 형식입니다.", retryable: false },
  INVALID_API_KEY: { message: "Gemini API Key를 확인해 주세요.", retryable: false },
  MODEL_UNAVAILABLE: { message: "선택한 번역 모델을 사용할 수 없습니다.", retryable: false },
  QUOTA_EXCEEDED: { message: "Gemini API 할당량이 소진되었습니다.", retryable: true },
  TRANSLATION_BLOCKED: { message: "안전 정책으로 번역할 수 없습니다.", retryable: false },
  TRANSLATION_FAILED: { message: "번역을 완료할 수 없습니다.", retryable: true },
  STORAGE_FULL: { message: "브라우저 저장 공간이 부족합니다.", retryable: true },
  OFFLINE: { message: "새 콘텐츠를 열려면 네트워크 연결이 필요합니다.", retryable: true },
} as const satisfies Record<PublicErrorCode, Omit<PublicError, "code">>;

export class SourceContractError extends Error {
  constructor(
    readonly code: PublicErrorCode,
    internalMessage?: string,
  ) {
    super(internalMessage);
    this.name = "SourceContractError";
  }
}

export const TRANSLATION_OUTPUT_ERROR_REASONS = [
  "MALFORMED_JSON",
  "INVALID_SCHEMA",
  "MISSING_ID",
  "DUPLICATE_ID",
  "UNEXPECTED_ID",
  "OUT_OF_ORDER",
] as const;

export type TranslationOutputErrorReason = (typeof TRANSLATION_OUTPUT_ERROR_REASONS)[number];

export class TranslationOutputError extends Error {
  readonly code = "TRANSLATION_FAILED" as const;

  constructor(readonly reason: TranslationOutputErrorReason) {
    super("Gemini translation output failed contract validation");
    this.name = "TranslationOutputError";
  }
}

export function publicErrorForCode(code: PublicErrorCode): PublicError {
  return { code, ...PUBLIC_ERRORS[code] };
}

export function toPublicError(error: unknown): PublicError {
  const code =
    error instanceof SourceContractError || error instanceof TranslationOutputError
      ? error.code
      : "EXTRACTION_FAILED";
  return publicErrorForCode(code);
}
