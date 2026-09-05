import { z } from "zod";

import {
  CatalogSourceSchema,
  ChapterSourceSchema,
  LocalEpubLocatorSchema,
} from "./source";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const nonEmptyTextSchema = z.string().trim().min(1);
const timestampSchema = z.string().datetime({ offset: true });

export { LocalEpubLocatorSchema };

export const LocalEpubChapterMetadataSchema = z
  .object({
    index: z.number().int().nonnegative(),
    canonicalUrl: LocalEpubLocatorSchema,
    title: nonEmptyTextSchema,
  })
  .strict();

export const LocalEpubBookSchema = z
  .object({
    id: sha256Schema,
    title: nonEmptyTextSchema,
    author: nonEmptyTextSchema.optional(),
    language: nonEmptyTextSchema.optional(),
    sourceByteSize: z.number().int().positive(),
    importedAt: timestampSchema,
    chapters: z.array(LocalEpubChapterMetadataSchema).min(1),
  })
  .strict();

export const LocalEpubChapterSchema = ChapterSourceSchema.superRefine((chapter, context) => {
  if (chapter.siteId !== "local-epub") {
    context.addIssue({ code: "custom", message: "Local EPUB chapters require the local site ID", path: ["siteId"] });
  }
  if (!LocalEpubLocatorSchema.safeParse(chapter.sourceUrl).success) {
    context.addIssue({ code: "custom", message: "Local EPUB chapter source must be a local locator", path: ["sourceUrl"] });
  }
  if (!LocalEpubLocatorSchema.safeParse(chapter.canonicalUrl).success) {
    context.addIssue({ code: "custom", message: "Local EPUB chapter URL must be a local locator", path: ["canonicalUrl"] });
  }
});

export const LocalEpubCatalogSchema = CatalogSourceSchema.superRefine((catalog, context) => {
  if (catalog.siteId !== "local-epub") {
    context.addIssue({ code: "custom", message: "Local EPUB catalogs require the local site ID", path: ["siteId"] });
  }
  if (!LocalEpubLocatorSchema.safeParse(catalog.sourceUrl).success) {
    context.addIssue({ code: "custom", message: "Local EPUB catalog source must be a local locator", path: ["sourceUrl"] });
  }
  if (!LocalEpubLocatorSchema.safeParse(catalog.canonicalUrl).success) {
    context.addIssue({ code: "custom", message: "Local EPUB catalog URL must be a local locator", path: ["canonicalUrl"] });
  }
  catalog.chapters.forEach((chapter, index) => {
    if (!LocalEpubLocatorSchema.safeParse(chapter.url).success) {
      context.addIssue({ code: "custom", message: "Local EPUB chapter URL must be a local locator", path: ["chapters", index, "url"] });
    }
  });
});

export type LocalEpubBook = z.infer<typeof LocalEpubBookSchema>;
export type LocalEpubChapterMetadata = z.infer<typeof LocalEpubChapterMetadataSchema>;
