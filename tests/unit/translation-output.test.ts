import { describe, expect, it } from "vitest";

import {
  TranslationOutputError,
  toPublicError,
} from "../../src/lib/errors";
import type { TranslationChunk } from "../../src/lib/translation/chunk";
import { validateTranslationOutput } from "../../src/lib/translation/validate-output";

const chunk: TranslationChunk = {
  chunkId: "chunk-0",
  paragraphs: [
    { id: "p-1", text: "비밀 원문 첫째" },
    { id: "p-2", text: "비밀 원문 둘째" },
  ],
};

function expectContractFailure(rawResponse: string, reason: TranslationOutputError["reason"]) {
  try {
    validateTranslationOutput(rawResponse, chunk);
    throw new Error("Expected translation output validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TranslationOutputError);
    expect(error).toMatchObject({ code: "TRANSLATION_FAILED", reason });
    return error as TranslationOutputError;
  }
}

describe("validateTranslationOutput", () => {
  it("returns translations when every requested ID appears exactly once in order", () => {
    const rawResponse = JSON.stringify({
      translations: [
        { id: "p-1", text: "첫 번째 번역" },
        { id: "p-2", text: "두 번째 번역" },
      ],
    });

    expect(validateTranslationOutput(rawResponse, chunk)).toEqual([
      { id: "p-1", text: "첫 번째 번역" },
      { id: "p-2", text: "두 번째 번역" },
    ]);
  });

  it("accepts an otherwise matching ID with a trailing colon emitted by Gemini", () => {
    const rawResponse = JSON.stringify({
      translations: [
        { id: "p-1: ", text: "첫 번째 번역" },
        { id: "p-2", text: "두 번째 번역" },
      ],
    });

    expect(validateTranslationOutput(rawResponse, chunk)).toEqual([
      { id: "p-1", text: "첫 번째 번역" },
      { id: "p-2", text: "두 번째 번역" },
    ]);
  });

  it("accepts a requested ID with a non-identifier suffix emitted by Gemini", () => {
    const rawResponse = JSON.stringify({
      translations: [
        { id: "p-1촌", text: "첫 번째 번역" },
        { id: "p-2", text: "두 번째 번역" },
      ],
    });

    expect(validateTranslationOutput(rawResponse, chunk)).toEqual([
      { id: "p-1", text: "첫 번째 번역" },
      { id: "p-2", text: "두 번째 번역" },
    ]);
  });

  it("accepts a requested ID with a single ASCII letter suffix emitted by Gemini", () => {
    const rawResponse = JSON.stringify({
      translations: [
        { id: "p-1T", text: "첫 번째 번역" },
        { id: "p-2", text: "두 번째 번역" },
      ],
    });

    expect(validateTranslationOutput(rawResponse, chunk)).toEqual([
      { id: "p-1", text: "첫 번째 번역" },
      { id: "p-2", text: "두 번째 번역" },
    ]);
  });

  it("rejects malformed JSON", () => {
    expectContractFailure('{"translations":', "MALFORMED_JSON");
  });

  it("rejects a missing requested ID", () => {
    expectContractFailure(
      JSON.stringify({ translations: [{ id: "p-1", text: "첫 번째 번역" }] }),
      "MISSING_ID",
    );
  });

  it("rejects a duplicate ID", () => {
    expectContractFailure(
      JSON.stringify({
        translations: [
          { id: "p-1", text: "첫 번째 번역" },
          { id: "p-1", text: "중복 번역" },
        ],
      }),
      "DUPLICATE_ID",
    );
  });

  it("rejects an unrequested ID", () => {
    expectContractFailure(
      JSON.stringify({
        translations: [
          { id: "p-1", text: "첫 번째 번역" },
          { id: "p-3", text: "추가 번역" },
        ],
      }),
      "UNEXPECTED_ID",
    );
  });

  it("rejects reordered IDs", () => {
    expectContractFailure(
      JSON.stringify({
        translations: [
          { id: "p-2", text: "두 번째 번역" },
          { id: "p-1", text: "첫 번째 번역" },
        ],
      }),
      "OUT_OF_ORDER",
    );
  });

  it("rejects empty translated text through the runtime schema", () => {
    expectContractFailure(
      JSON.stringify({
        translations: [
          { id: "p-1", text: "첫 번째 번역" },
          { id: "p-2", text: "   " },
        ],
      }),
      "INVALID_SCHEMA",
    );
  });

  it.each([
    ["Markdown code fence", '```json\n{"translations":[]}\n```'],
    ["leading explanation", '번역 결과입니다.\n{"translations":[]}'],
    ["trailing explanation", '{"translations":[]}\n완료했습니다.'],
  ])("rejects JSON wrapped in %s", (_label, rawResponse) => {
    expectContractFailure(rawResponse, "MALFORMED_JSON");
  });

  it("does not expose source, translation, or the raw response in public errors", () => {
    const privateTranslation = "노출되면 안 되는 번역";
    const rawResponse = `응답 해설 ${privateTranslation}`;
    const internalError = expectContractFailure(rawResponse, "MALFORMED_JSON");
    const publicError = toPublicError(internalError);
    const serialized = JSON.stringify(publicError);

    expect(publicError).toEqual({
      code: "TRANSLATION_FAILED",
      message: "번역을 완료할 수 없습니다.",
      retryable: true,
    });
    expect(serialized).not.toContain(rawResponse);
    expect(serialized).not.toContain(privateTranslation);
    expect(serialized).not.toContain(chunk.paragraphs[0].text);
    expect(internalError.message).not.toContain(rawResponse);
  });
});
