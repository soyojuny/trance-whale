import "client-only";

import type { LocalEpubLocator } from "../../types/source";

export function createLocalEpubLocator(bookId: string, chapterIndex: number): LocalEpubLocator {
  return `local-epub://book/${bookId}/chapter/${chapterIndex}`;
}

export function parseLocalEpubLocator(locator: string): { bookId: string; chapterIndex: number } | undefined {
  const match = /^local-epub:\/\/book\/([a-f0-9]{64})\/chapter\/(0|[1-9]\d*)$/i.exec(locator);
  if (!match) return undefined;
  return { bookId: match[1], chapterIndex: Number(match[2]) };
}
