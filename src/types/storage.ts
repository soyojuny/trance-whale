import { z } from "zod";

import { DEFAULT_TRANSLATION_MODE, TranslationModeSchema } from "../lib/translation/models";
import { UserPromptSchema } from "../lib/translation/prompt";
import { CatalogSourceSchema, ChapterSourceSchema, SourceLocatorSchema } from "./source";
import { LocalEpubBookSchema } from "./epub";
import { TranslationParagraphSchema } from "./translation";

const timestampSchema = z.string().datetime({ offset: true });
const nonEmptyStringSchema = z.string().trim().min(1);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const ViewModeSchema = z.enum(["translation", "original", "both"]);

export const TranslationSettingsSchema = z
  .object({
    apiKey: z.string(),
    userPrompt: UserPromptSchema,
    translationMode: TranslationModeSchema,
  })
  .strict();

export const ReaderSettingsSchema = z
  .object({
    viewMode: ViewModeSchema,
    fontSize: z.number().min(16).max(24),
    lineHeight: z.number().positive(),
  })
  .strict();

export const LastReadingPositionSchema = z
  .object({
    canonicalUrl: SourceLocatorSchema,
    scrollPosition: z.number().nonnegative(),
    updatedAt: timestampSchema,
  })
  .strict();

const translatedParagraphsSchema = z
  .array(TranslationParagraphSchema)
  .min(1)
  .superRefine((paragraphs, context) => {
    const ids = new Set<string>();

    paragraphs.forEach((paragraph, index) => {
      if (ids.has(paragraph.id)) {
        context.addIssue({
          code: "custom",
          message: "Translated paragraph IDs must be unique",
          path: [index, "id"],
        });
      }
      ids.add(paragraph.id);
    });
  });

const translationCacheBaseShape = {
  cacheKey: sha256Schema,
  canonicalUrl: SourceLocatorSchema,
  contentHash: sha256Schema,
  modelId: nonEmptyStringSchema,
  targetLanguage: z.literal("ko"),
  basePromptVersion: nonEmptyStringSchema,
  userPromptHash: sha256Schema,
  createdAt: timestampSchema,
  accessedAt: timestampSchema,
  byteSize: z.number().int().nonnegative(),
} as const;

export const TranslationCacheRecordSchema = z
  .object({
    ...translationCacheBaseShape,
    kind: z.literal("complete").optional(),
    translatedParagraphs: translatedParagraphsSchema,
  })
  .strict();

const paragraphIdsSchema = z.array(nonEmptyStringSchema).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "Paragraph IDs must be unique" });
  }
});

export const PartialTranslationCacheRecordSchema = z
  .object({
    ...translationCacheBaseShape,
    kind: z.literal("partial"),
    progressStatus: z.enum(["translating", "partial_failure", "cancelled", "failed"]),
    translatedParagraphs: translatedParagraphsSchema,
    totalParagraphs: z.number().int().positive(),
    unfinishedParagraphIds: paragraphIdsSchema.min(1),
    failedParagraphIds: paragraphIdsSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const translatedIds = new Set(record.translatedParagraphs.map(({ id }) => id));
    if (record.translatedParagraphs.length + record.unfinishedParagraphIds.length !== record.totalParagraphs) {
      context.addIssue({
        code: "custom",
        message: "Stored progress must account for every paragraph",
        path: ["totalParagraphs"],
      });
    }
    if (record.unfinishedParagraphIds.some((id) => translatedIds.has(id))) {
      context.addIssue({
        code: "custom",
        message: "Unfinished paragraph IDs must not be translated",
        path: ["unfinishedParagraphIds"],
      });
    }
    if (record.failedParagraphIds.some((id) => !record.unfinishedParagraphIds.includes(id))) {
      context.addIssue({
        code: "custom",
        message: "Failed paragraph IDs must be unfinished",
        path: ["failedParagraphIds"],
      });
    }
  });

export const StoredTranslationCacheRecordSchema = z.union([
  PartialTranslationCacheRecordSchema,
  TranslationCacheRecordSchema,
]);

export const CatalogCacheRecordSchema = z
  .object({
    canonicalUrl: SourceLocatorSchema,
    catalog: CatalogSourceSchema,
    createdAt: timestampSchema,
    accessedAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict();

export const SourceCacheRecordSchema = z
  .object({
    canonicalUrl: SourceLocatorSchema,
    createdAt: timestampSchema,
    chapter: ChapterSourceSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.canonicalUrl !== record.chapter.canonicalUrl) {
      context.addIssue({
        code: "custom",
        message: "Source cache key must match the chapter canonical URL",
        path: ["canonicalUrl"],
      });
    }
  });

export const LocalEpubArchiveRecordSchema = z
  .object({
    bookId: sha256Schema,
    byteSize: z.number().int().positive(),
    chunkCount: z.number().int().positive(),
    chapterPaths: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const LocalEpubArchiveChunkRecordSchema = z
  .object({
    id: z.string().min(1),
    bookId: sha256Schema,
    index: z.number().int().nonnegative(),
    encodedBytes: z.string().min(1),
  })
  .strict();

export const DEFAULT_TRANSLATION_SETTINGS = {
  apiKey: "",
  userPrompt: "",
  translationMode: DEFAULT_TRANSLATION_MODE,
} as const satisfies TranslationSettings;

export const DEFAULT_READER_SETTINGS = {
  viewMode: "translation",
  fontSize: 19,
  lineHeight: 2,
} as const satisfies ReaderSettings;

export type ViewMode = z.infer<typeof ViewModeSchema>;
export type TranslationSettings = z.infer<typeof TranslationSettingsSchema>;
export type ReaderSettings = z.infer<typeof ReaderSettingsSchema>;
export type LastReadingPosition = z.infer<typeof LastReadingPositionSchema>;
export type TranslationCacheRecord = z.infer<typeof TranslationCacheRecordSchema>;
export type PartialTranslationCacheRecord = z.infer<typeof PartialTranslationCacheRecordSchema>;
export type StoredTranslationCacheRecord = z.infer<typeof StoredTranslationCacheRecordSchema>;
export type CatalogCacheRecord = z.infer<typeof CatalogCacheRecordSchema>;
export type SourceCacheRecord = z.infer<typeof SourceCacheRecordSchema>;
export type LocalEpubBookRecord = z.infer<typeof LocalEpubBookSchema>;
export type LocalEpubArchiveRecord = z.infer<typeof LocalEpubArchiveRecordSchema>;
export type LocalEpubArchiveChunkRecord = z.infer<typeof LocalEpubArchiveChunkRecordSchema>;
