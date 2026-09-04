import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSLATION_CHARACTER_BUDGET,
  chunkParagraphs,
} from "../../src/lib/translation/chunk";

describe("chunkParagraphs", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkParagraphs([])).toEqual([]);
  });

  it("keeps paragraphs in one chunk up to the exact character budget", () => {
    const paragraphs = [
      { id: "p-1", text: "abc" },
      { id: "p-2", text: "de" },
    ];

    expect(chunkParagraphs(paragraphs, 5)).toEqual([
      { chunkId: "chunk-0", paragraphs },
    ]);
  });

  it("starts a new chunk before the combined character budget is exceeded", () => {
    const paragraphs = [
      { id: "p-1", text: "1234" },
      { id: "p-2", text: "56" },
      { id: "p-3", text: "789" },
    ];

    expect(chunkParagraphs(paragraphs, 5)).toEqual([
      { chunkId: "chunk-0", paragraphs: [paragraphs[0]] },
      { chunkId: "chunk-1", paragraphs: [paragraphs[1], paragraphs[2]] },
    ]);
  });

  it("places an oversized paragraph in its own chunk without losing content", () => {
    const paragraphs = [
      { id: "p-1", text: "short" },
      { id: "p-2", text: "a paragraph longer than the budget" },
      { id: "p-3", text: "end" },
    ];

    const chunks = chunkParagraphs(paragraphs, 8);

    expect(chunks).toEqual([
      { chunkId: "chunk-0", paragraphs: [paragraphs[0]] },
      { chunkId: "chunk-1", paragraphs: [paragraphs[1]] },
      { chunkId: "chunk-2", paragraphs: [paragraphs[2]] },
    ]);
  });

  it("counts multilingual Unicode and line breaks without changing their content", () => {
    const paragraphs = [
      { id: "zh", text: "你好\n" },
      { id: "ko", text: "고래🐋" },
      { id: "en", text: "end" },
    ];

    const chunks = chunkParagraphs(paragraphs, 6);

    expect(chunks).toEqual([
      { chunkId: "chunk-0", paragraphs: [paragraphs[0], paragraphs[1]] },
      { chunkId: "chunk-1", paragraphs: [paragraphs[2]] },
    ]);
    expect(chunks.flatMap((chunk) => chunk.paragraphs)).toEqual(paragraphs);
  });

  it("preserves every ID once in order without mutating input and is deterministic", () => {
    const paragraphs = Object.freeze([
      Object.freeze({ id: "p-1", text: "one" }),
      Object.freeze({ id: "p-2", text: "two" }),
      Object.freeze({ id: "p-3", text: "three" }),
    ]);
    const snapshot = structuredClone(paragraphs);

    const first = chunkParagraphs(paragraphs, 5);
    const second = chunkParagraphs(paragraphs, 5);

    expect(first.flatMap((chunk) => chunk.paragraphs.map((paragraph) => paragraph.id))).toEqual([
      "p-1",
      "p-2",
      "p-3",
    ]);
    expect(paragraphs).toEqual(snapshot);
    expect(second).toEqual(first);
  });

  it("exports a conservative default character budget", () => {
    expect(DEFAULT_TRANSLATION_CHARACTER_BUDGET).toBeGreaterThan(0);
    expect(chunkParagraphs([{ id: "p-1", text: "text" }])).toHaveLength(1);
  });
});
