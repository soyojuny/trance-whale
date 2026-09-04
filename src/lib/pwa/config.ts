export const APP_CACHE_STORAGE_PREFIX = "trance-whale-app-shell:";
export const APP_SHELL_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "v1";
export const APP_SHELL_CACHE_NAME = `${APP_CACHE_STORAGE_PREFIX}${APP_SHELL_BUILD_ID}`;
export const APP_SHELL_PATH = "/";
export const PRECACHE_PATHS = [
  APP_SHELL_PATH,
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
] as const;

export const SENSITIVE_REQUEST_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
] as const;
