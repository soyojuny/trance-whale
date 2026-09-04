import { describe, expect, it } from "vitest";

import { TRANSLATION_MODELS } from "../../src/lib/translation/models";
import { BASE_PROMPT_VERSION } from "../../src/lib/translation/prompt";
import {
  createTranslationCacheKey,
  type TranslationCacheKeyInput,
} from "../../src/lib/translation/cache-key.client";

const input: TranslationCacheKeyInput = {
  canonicalUrl: "https://www.69shuba.com/txt/48273/32028706",
  contentHash: "a".repeat(64),
  modelId: TRANSLATION_MODELS.fast.modelId,
  targetLanguage: "ko",
  basePromptVersion: BASE_PROMPT_VERSION,
  userPrompt: "인물 이름은 음역해 주세요.",
};

describe("createTranslationCacheKey", () => {
  it("is deterministic regardless of input property construction order", async () => {
    const reordered = {
      userPrompt: input.userPrompt,
      basePromptVersion: input.basePromptVersion,
      targetLanguage: input.targetLanguage,
      modelId: input.modelId,
      contentHash: input.contentHash,
      canonicalUrl: input.canonicalUrl,
    };

    const first = await createTranslationCacheKey(input);
    const second = await createTranslationCacheKey(input);
    const third = await createTranslationCacheKey(reordered);

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it.each([
    ["canonical URL", { canonicalUrl: `${input.canonicalUrl}/` }],
    ["content hash", { contentHash: "b".repeat(64) }],
    ["model", { modelId: TRANSLATION_MODELS.quality.modelId }],
    ["target language", { targetLanguage: "en" }],
    ["base prompt version", { basePromptVersion: "v2" }],
    ["user prompt", { userPrompt: "경지명은 한자 독음으로 번역해 주세요." }],
  ])("changes when only %s changes", async (_label, changed) => {
    await expect(createTranslationCacheKey({ ...input, ...changed })).resolves.not.toBe(
      await createTranslationCacheKey(input),
    );
  });

  it("hashes the prompt before the explicitly ordered cache material", async () => {
    const observed: string[] = [];
    const hash = async (value: string) => {
      observed.push(value);
      return observed.length === 1 ? "prompt-hash" : "cache-key";
    };

    await expect(createTranslationCacheKey(input, hash)).resolves.toBe("cache-key");
    expect(observed).toEqual([
      input.userPrompt,
      JSON.stringify({
        canonicalUrl: input.canonicalUrl,
        contentHash: input.contentHash,
        modelId: input.modelId,
        targetLanguage: input.targetLanguage,
        basePromptVersion: input.basePromptVersion,
        userPromptHash: "prompt-hash",
      }),
    ]);
    expect(observed[1]).not.toContain(input.userPrompt);
  });

  it("never includes an API key in hash material or the returned key", async () => {
    const apiKey = "secret-api-key-that-must-not-leak";
    const observed: string[] = [];
    const hash = async (value: string) => {
      observed.push(value);
      return `hash-${observed.length}`;
    };
    const inputWithUnexpectedSecret = { ...input, apiKey };

    const cacheKey = await createTranslationCacheKey(inputWithUnexpectedSecret, hash);

    expect(cacheKey).toBe("hash-2");
    expect(cacheKey).not.toContain(apiKey);
    expect(observed).not.toContain(apiKey);
    expect(observed.every((value) => !value.includes(apiKey))).toBe(true);
  });
});
