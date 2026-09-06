import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  APP_CACHE_STORAGE_PREFIX,
  APP_SHELL_CACHE_NAME,
  APP_SHELL_PATH,
  createAppShellCacheName,
  PRECACHE_PATHS,
  resolveAppShellBuildId,
} from "../../src/lib/pwa/config.server";
import {
  activateAppShell,
  fetchAppShell,
  installAppShell,
  shouldHandleRequest,
} from "../../src/lib/pwa/service-worker";
import {
  registerServiceWorker,
  shouldRegisterServiceWorker,
} from "../../src/services/service-worker-registration.client";

function request(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe("service worker cache boundary", () => {
  it("uses an immutable deployment ID for each production app shell cache", () => {
    expect(resolveAppShellBuildId("production", "release-a")).toBe("release-a");
    expect(createAppShellCacheName("release-a")).not.toBe(createAppShellCacheName("release-b"));
  });

  it("rejects production builds without a deployment ID while preserving a local development cache", () => {
    expect(() => resolveAppShellBuildId("production")).toThrow("PWA_BUILD_ID");
    expect(resolveAppShellBuildId("development")).toBe("local");
  });

  it("shares a versioned app-owned cache and precaches only same-origin shell assets", async () => {
    const addAll = vi.fn().mockResolvedValue(undefined);
    const caches = { open: vi.fn().mockResolvedValue({ addAll }) };

    await installAppShell(caches as never);

    expect(APP_SHELL_CACHE_NAME).toMatch(new RegExp(`^${APP_CACHE_STORAGE_PREFIX}.+`));
    expect(PRECACHE_PATHS).toContain(APP_SHELL_PATH);
    expect(PRECACHE_PATHS.every((path) => path.startsWith("/"))).toBe(true);
    expect(addAll).toHaveBeenCalledWith(PRECACHE_PATHS);
  });

  it.each([
    ["API", request("https://reader.example/api/source/chapter")],
    ["Gemini", request("https://generativelanguage.googleapis.com/v1beta/models/x")],
    ["external", request("https://www.69shuba.com/txt/1/2")],
    ["non-GET", request("https://reader.example/read", { method: "POST" })],
    ["authorization", request("https://reader.example/read", { headers: { authorization: "secret" } })],
    ["API key", request("https://reader.example/read", { headers: { "x-goog-api-key": "secret" } })],
  ])("does not inspect or cache %s requests", (_name, value) => {
    expect(shouldHandleRequest(value, "https://reader.example")).toBe(false);
  });

  it("handles same-origin navigation and known static assets", () => {
    expect(shouldHandleRequest(request("https://reader.example/read"), "https://reader.example")).toBe(true);
    expect(shouldHandleRequest(request("https://reader.example/_next/static/app.js"), "https://reader.example")).toBe(true);
  });

  it("removes only older app cache versions", async () => {
    const deleteCache = vi.fn().mockResolvedValue(true);
    const caches = {
      keys: vi.fn().mockResolvedValue([
        `${APP_CACHE_STORAGE_PREFIX}old`, APP_SHELL_CACHE_NAME, "another-app:cache",
      ]),
      delete: deleteCache,
    };

    await activateAppShell(caches as never);

    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith(`${APP_CACHE_STORAGE_PREFIX}old`);
  });

  it("uses cached assets first and falls back to the shell for offline navigation", async () => {
    const shell = new Response("shell");
    const cache = { match: vi.fn().mockResolvedValue(shell), put: vi.fn() };
    const caches = { open: vi.fn().mockResolvedValue(cache) };
    const network = vi.fn().mockRejectedValue(new TypeError("offline"));

    const response = await fetchAppShell(
      request("https://reader.example/read"),
      "https://reader.example",
      caches as never,
      network,
    );

    expect(await response.text()).toBe("shell");
    expect(cache.match).toHaveBeenCalledWith("/read");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("registers without reload, update activation, or skipWaiting", async () => {
    const registration = { waiting: { postMessage: vi.fn() } };
    const serviceWorker = { register: vi.fn().mockResolvedValue(registration) };
    await registerServiceWorker(serviceWorker as never);

    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(registration.waiting.postMessage).not.toHaveBeenCalled();
  });

  it("registers only in production so development does not serve stale app bundles", () => {
    expect(shouldRegisterServiceWorker("production")).toBe(true);
    expect(shouldRegisterServiceWorker("development")).toBe(false);
    expect(shouldRegisterServiceWorker("test")).toBe(false);
  });
});
