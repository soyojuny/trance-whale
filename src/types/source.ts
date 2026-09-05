import { z } from "zod";

export const HttpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "URL must use HTTP or HTTPS");

export const LocalEpubLocatorSchema = z
  .string()
  .regex(/^local-epub:\/\/book\/[a-f0-9]{64}\/chapter\/(?:0|[1-9]\d*)$/i);

export const SourceLocatorSchema = z.union([HttpUrlSchema, LocalEpubLocatorSchema]);

const identifierSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const nonEmptyTextSchema = z.string().trim().min(1);

export const SourceRequestSchema = z
  .object({
    url: HttpUrlSchema,
  })
  .strict();

export const NavigationTargetSchema = z
  .object({
    url: SourceLocatorSchema,
    label: nonEmptyTextSchema.optional(),
  })
  .strict();

export const ParagraphSchema = z
  .object({
    id: identifierSchema,
    text: nonEmptyTextSchema,
  })
  .strict();

const paragraphsSchema = z.array(ParagraphSchema).min(1).superRefine((paragraphs, context) => {
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

export const CatalogChapterSchema = z
  .object({
    id: identifierSchema,
    url: SourceLocatorSchema,
    title: nonEmptyTextSchema,
    number: z.number().int().positive().optional(),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const ChapterSourceSchema = z
  .object({
    kind: z.literal("chapter"),
    sourceUrl: SourceLocatorSchema,
    canonicalUrl: SourceLocatorSchema,
    siteId: identifierSchema,
    bookId: identifierSchema.optional(),
    bookTitle: nonEmptyTextSchema.optional(),
    chapterId: identifierSchema.optional(),
    chapterNumber: z.number().int().positive().optional(),
    chapterTitle: nonEmptyTextSchema,
    paragraphs: paragraphsSchema,
    navigation: z
      .object({
        previous: NavigationTargetSchema.optional(),
        catalog: NavigationTargetSchema.optional(),
        next: NavigationTargetSchema.optional(),
      })
      .strict(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/i),
    fetchedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const CatalogSourceSchema = z
  .object({
    kind: z.literal("catalog"),
    sourceUrl: SourceLocatorSchema,
    canonicalUrl: SourceLocatorSchema,
    siteId: identifierSchema,
    bookId: identifierSchema.optional(),
    bookTitle: nonEmptyTextSchema,
    chapters: z.array(CatalogChapterSchema).min(1),
    fetchedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type SourceRequest = z.infer<typeof SourceRequestSchema>;
export type LocalEpubLocator = `local-epub://book/${string}/chapter/${number}`;
export type NavigationTarget = z.infer<typeof NavigationTargetSchema>;
export type Paragraph = z.infer<typeof ParagraphSchema>;
export type CatalogChapter = z.infer<typeof CatalogChapterSchema>;
export type ChapterSource = z.infer<typeof ChapterSourceSchema>;
export type CatalogSource = z.infer<typeof CatalogSourceSchema>;
