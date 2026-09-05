import "client-only";

import type { LocalEpubLocator } from "../../types/source";

export function createLocalEpubLocator(bookId: string, chapterIndex: number): LocalEpubLocator {
  return `local-epub://book/${bookId}/chapter/${chapterIndex}`;
}
