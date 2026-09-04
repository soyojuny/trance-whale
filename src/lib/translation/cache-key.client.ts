export type TranslationCacheKeyInput = {
  canonicalUrl: string;
  contentHash: string;
  modelId: string;
  targetLanguage: string;
  basePromptVersion: string;
  userPrompt: string;
};

export type HashText = (value: string) => Promise<string>;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createTranslationCacheKey(
  input: TranslationCacheKeyInput,
  hash: HashText = sha256,
): Promise<string> {
  const userPromptHash = await hash(input.userPrompt);
  const material = JSON.stringify({
    canonicalUrl: input.canonicalUrl,
    contentHash: input.contentHash,
    modelId: input.modelId,
    targetLanguage: input.targetLanguage,
    basePromptVersion: input.basePromptVersion,
    userPromptHash,
  });

  return hash(material);
}
