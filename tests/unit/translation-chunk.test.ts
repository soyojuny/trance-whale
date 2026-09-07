import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSLATION_CHARACTER_BUDGET,
  DEFAULT_TRANSLATION_PARAGRAPH_BUDGET,
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

  it("limits the default chunk to 24 paragraphs while preserving order", () => {
    const paragraphs = Array.from({ length: 25 }, (_, index) => ({
      id: `p-${index}`,
      text: "text",
    }));

    expect(DEFAULT_TRANSLATION_PARAGRAPH_BUDGET).toBe(24);
    expect(chunkParagraphs(paragraphs)).toEqual([
      { chunkId: "chunk-0", paragraphs: paragraphs.slice(0, 24) },
      { chunkId: "chunk-1", paragraphs: paragraphs.slice(24) },
    ]);
  });

  it("starts a new default chunk after exactly 2,000 characters", () => {
    const paragraphs = [
      { id: "p-1", text: "a".repeat(1_000) },
      { id: "p-2", text: "b".repeat(1_000) },
      { id: "p-3", text: "c" },
    ];

    expect(DEFAULT_TRANSLATION_CHARACTER_BUDGET).toBe(2_000);
    expect(chunkParagraphs(paragraphs)).toEqual([
      { chunkId: "chunk-0", paragraphs: paragraphs.slice(0, 2) },
      { chunkId: "chunk-1", paragraphs: paragraphs.slice(2) },
    ]);
  });

  it("lets callers override both limits with deterministic chunk IDs", () => {
    const paragraphs = [
      { id: "p-1", text: "a" },
      { id: "p-2", text: "b" },
      { id: "p-3", text: "cd" },
      { id: "p-4", text: "efgh" },
    ];
    const chunks = chunkParagraphs(paragraphs, 5, 2);

    expect(chunks).toEqual([
      { chunkId: "chunk-0", paragraphs: paragraphs.slice(0, 2) },
      { chunkId: "chunk-1", paragraphs: [paragraphs[2]] },
      { chunkId: "chunk-2", paragraphs: [paragraphs[3]] },
    ]);
    expect(chunkParagraphs(paragraphs, 5, 2)).toEqual(chunks);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    "rejects an invalid character budget: %s",
    (budget) => {
      expect(() => chunkParagraphs([], budget)).toThrow(RangeError);
    },
  );

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    "rejects an invalid paragraph budget: %s",
    (budget) => {
      expect(() => chunkParagraphs([], undefined, budget)).toThrow(RangeError);
    },
  );

  it("isolates a paragraph exceeding the default budget", () => {
    const paragraphs = [
      { id: "p-1", text: "before" },
      { id: "p-2", text: "x".repeat(2_001) },
      { id: "p-3", text: "after" },
    ];

    expect(chunkParagraphs(paragraphs)).toEqual(
      paragraphs.map((paragraph, index) => ({
        chunkId: `chunk-${index}`,
        paragraphs: [paragraph],
      })),
    );
  });
});
