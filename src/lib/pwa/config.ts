import { APP_CACHE_STORAGE_PREFIX } from "./cache-constants";

export { APP_CACHE_STORAGE_PREFIX } from "./cache-constants";

export function resolveAppShellBuildId(
  environment = process.env.NODE_ENV,
  buildId = process.env.PWA_BUILD_ID,
): string {
  const normalizedBuildId = buildId?.trim();
  if (normalizedBuildId) return normalizedBuildId;
  if (environment === "production") {
    throw new Error("PWA_BUILD_ID is required for production builds");
  }
  return "local";
}

export function createAppShellCacheName(buildId: string): string {
  return `${APP_CACHE_STORAGE_PREFIX}${buildId}`;
}

export const APP_SHELL_BUILD_ID = resolveAppShellBuildId();
export const APP_SHELL_CACHE_NAME = createAppShellCacheName(APP_SHELL_BUILD_ID);
export const APP_SHELL_PATH = "/";
export const PRECACHE_PATHS = [
  APP_SHELL_PATH,
  "/read",
  "/manifest.webmanifest",
  "/icons/icon.png",
  "/icons/apple-touch-icon.png",
] as const;

export const SENSITIVE_REQUEST_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
] as const;
