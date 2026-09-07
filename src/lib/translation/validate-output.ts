import { TranslationOutputError } from "../errors";
import type { TranslationChunk } from "./chunk";
import {
  StructuredTranslationOutputSchema,
  type TranslationParagraph,
} from "../../types/translation";

export function validateTranslationOutput(
  rawResponse: string,
  chunk: TranslationChunk,
): TranslationParagraph[] {
  let decoded: unknown;

  try {
    decoded = JSON.parse(rawResponse);
  } catch {
    throw new TranslationOutputError("MALFORMED_JSON");
  }

  const parsed = StructuredTranslationOutputSchema.safeParse(decoded);

  if (!parsed.success) {
    const hasDuplicateId = parsed.error.issues.some(
      (issue) => issue.code === "custom" && issue.message === "Paragraph IDs must be unique",
    );
    throw new TranslationOutputError(hasDuplicateId ? "DUPLICATE_ID" : "INVALID_SCHEMA");
  }

  const requestedIds = chunk.paragraphs.map((paragraph) => paragraph.id);
  const requestedIdSet = new Set(requestedIds);
  const translations = parsed.data.translations.map((paragraph) => {
    const trimmedId = paragraph.id.trim();
    const idWithoutTrailingColon = trimmedId.endsWith(":")
      ? trimmedId.slice(0, -1).trimEnd()
      : trimmedId;
    const id = requestedIdSet.has(idWithoutTrailingColon)
      ? idWithoutTrailingColon
      : paragraph.id;
    return { ...paragraph, id };
  });
  const translatedIds = translations.map((paragraph) => paragraph.id);

  if (translatedIds.some((id) => !requestedIdSet.has(id))) {
    throw new TranslationOutputError("UNEXPECTED_ID");
  }

  if (new Set(translatedIds).size !== translatedIds.length) {
    throw new TranslationOutputError("DUPLICATE_ID");
  }

  const translatedIdSet = new Set(translatedIds);

  if (requestedIds.some((id) => !translatedIdSet.has(id))) {
    throw new TranslationOutputError("MISSING_ID");
  }

  if (requestedIds.some((id, index) => translatedIds[index] !== id)) {
    throw new TranslationOutputError("OUT_OF_ORDER");
  }

  return translations;
}
