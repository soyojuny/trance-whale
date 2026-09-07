import { afterEach, describe, expect, it, vi } from "vitest";
// Vitest transforms JSX with jsxDEV even when the browser environment is production.
import "react/jsx-dev-runtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local data client boundary", () => {
  it("does not require the server app-shell build ID in a production browser bundle", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PWA_BUILD_ID", "");

    await expect(import("../../src/services/local-data.client")).resolves.toBeDefined();
    await expect(import("../../src/lib/translation/cached-pipeline.client")).resolves.toBeDefined();
    await expect(import("../../src/components/reader/reader-navigation.client")).resolves.toBeDefined();
  });
});
