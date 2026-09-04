import type { TranslationParagraph } from "../../types/translation";

// This is a character budget, not a token limit. The exact token policy remains undecided.
export const DEFAULT_TRANSLATION_CHARACTER_BUDGET = 6_000;

export type TranslationChunk = {
  chunkId: string;
  paragraphs: TranslationParagraph[];
};

function countCharacters(text: string): number {
  return Array.from(text).length;
}

export function chunkParagraphs(
  paragraphs: readonly TranslationParagraph[],
  characterBudget = DEFAULT_TRANSLATION_CHARACTER_BUDGET,
): TranslationChunk[] {
  if (!Number.isInteger(characterBudget) || characterBudget <= 0) {
    throw new RangeError("characterBudget must be a positive integer");
  }

  const chunks: TranslationChunk[] = [];
  let currentParagraphs: TranslationParagraph[] = [];
  let currentCharacterCount = 0;

  const appendCurrentChunk = () => {
    if (currentParagraphs.length === 0) {
      return;
    }

    chunks.push({
      chunkId: `chunk-${chunks.length}`,
      paragraphs: currentParagraphs,
    });
    currentParagraphs = [];
    currentCharacterCount = 0;
  };

  for (const paragraph of paragraphs) {
    const characterCount = countCharacters(paragraph.text);

    if (
      currentParagraphs.length > 0 &&
      currentCharacterCount + characterCount > characterBudget
    ) {
      appendCurrentChunk();
    }

    currentParagraphs.push({ ...paragraph });
    currentCharacterCount += characterCount;

    if (characterCount > characterBudget) {
      appendCurrentChunk();
    }
  }

  appendCurrentChunk();

  return chunks;
}
