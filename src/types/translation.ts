import { z } from "zod";

const nonEmptyStringSchema = z.string().trim().min(1);

export const TranslationParagraphSchema = z
  .object({
    id: nonEmptyStringSchema,
    text: nonEmptyStringSchema,
  })
  .strict();

function uniqueParagraphsSchema(minimumLength: number) {
  return z
    .array(TranslationParagraphSchema)
    .min(minimumLength)
    .superRefine((paragraphs, context) => {
      const ids = new Set<string>();

      paragraphs.forEach((paragraph, index) => {
        if (ids.has(paragraph.id)) {
          context.addIssue({
            code: "custom",
            message: "Paragraph IDs must be unique",
            path: [index, "id"],
          });
        }
        ids.add(paragraph.id);
      });
    });
}

export const TranslationRequestSchema = z
  .object({
    paragraphs: uniqueParagraphsSchema(1),
  })
  .strict();

export const StructuredTranslationOutputSchema = z
  .object({
    translations: uniqueParagraphsSchema(1),
  })
  .strict();

export const TranslationChunkResultSchema = z
  .object({
    chunkId: nonEmptyStringSchema,
    translations: uniqueParagraphsSchema(1),
  })
  .strict();

export const TranslationProgressStatusSchema = z.enum([
  "translating",
  "complete",
  "partial_failure",
  "cancelled",
  "failed",
]);

export const TranslationProgressSchema = z
  .object({
    status: TranslationProgressStatusSchema,
    completedParagraphs: z.number().int().nonnegative(),
    totalParagraphs: z.number().int().nonnegative(),
    translations: uniqueParagraphsSchema(0),
    failedChunkIds: z.array(nonEmptyStringSchema),
  })
  .strict()
  .superRefine((progress, context) => {
    if (progress.completedParagraphs > progress.totalParagraphs) {
      context.addIssue({
        code: "custom",
        message: "Completed paragraphs cannot exceed total paragraphs",
        path: ["completedParagraphs"],
      });
    }

    if (progress.completedParagraphs !== progress.translations.length) {
      context.addIssue({
        code: "custom",
        message: "Completed paragraph count must match translations",
        path: ["completedParagraphs"],
      });
    }

    if (new Set(progress.failedChunkIds).size !== progress.failedChunkIds.length) {
      context.addIssue({
        code: "custom",
        message: "Failed chunk IDs must be unique",
        path: ["failedChunkIds"],
      });
    }
  });

export type TranslationParagraph = z.infer<typeof TranslationParagraphSchema>;
export type TranslationRequest = z.infer<typeof TranslationRequestSchema>;
export type StructuredTranslationOutput = z.infer<typeof StructuredTranslationOutputSchema>;
export type TranslationChunkResult = z.infer<typeof TranslationChunkResultSchema>;
export type TranslationProgressStatus = z.infer<typeof TranslationProgressStatusSchema>;
export type TranslationProgress = z.infer<typeof TranslationProgressSchema>;
