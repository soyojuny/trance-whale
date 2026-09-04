import {
  APP_CACHE_STORAGE_PREFIX,
  APP_SHELL_CACHE_NAME,
  APP_SHELL_PATH,
  PRECACHE_PATHS,
  SENSITIVE_REQUEST_HEADERS,
} from "./config";

type CacheLike = {
  addAll(requests: readonly string[]): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  put(request: RequestInfo | URL, response: Response): Promise<void>;
};

type CacheStorageLike = {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
};

type FetchLike = (request: Request) => Promise<Response>;

function isStaticPath(pathname: string): boolean {
  return pathname.startsWith("/_next/static/")
    || pathname.startsWith("/icons/")
    || pathname === "/manifest.webmanifest"
    || pathname === "/favicon.ico";
}

export function shouldHandleRequest(request: Request, origin: string): boolean {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  if (url.origin !== origin || url.pathname.startsWith("/api/")) return false;
  if (SENSITIVE_REQUEST_HEADERS.some((name) => request.headers.has(name))) return false;
  return request.mode === "navigate" || isStaticPath(url.pathname) || url.pathname === "/read";
}

export async function installAppShell(caches: CacheStorageLike): Promise<void> {
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  await cache.addAll(PRECACHE_PATHS);
}

export async function activateAppShell(caches: CacheStorageLike): Promise<void> {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(APP_CACHE_STORAGE_PREFIX) && name !== APP_SHELL_CACHE_NAME)
    .map((name) => caches.delete(name)));
}

export async function fetchAppShell(
  request: Request,
  origin: string,
  caches: CacheStorageLike,
  network: FetchLike,
): Promise<Response> {
  const cache = await caches.open(APP_SHELL_CACHE_NAME);
  const url = new URL(request.url);
  const navigation = request.mode === "navigate" || url.pathname === "/read";

  if (navigation) {
    try {
      return await network(request);
    } catch {
      const shell = await cache.match(url.pathname === "/read" ? "/read" : APP_SHELL_PATH);
      if (shell) return shell;
      throw new TypeError("Offline app shell is unavailable");
    }
  }

  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await network(request);
  if (response.ok && response.type !== "opaque") await cache.put(request, response.clone());
  return response;
}

export function createServiceWorkerScript(): string {
  return `const CACHE_NAME=${JSON.stringify(APP_SHELL_CACHE_NAME)};
const CACHE_PREFIX=${JSON.stringify(APP_CACHE_STORAGE_PREFIX)};
const SHELL=${JSON.stringify(APP_SHELL_PATH)};
const PRECACHE=${JSON.stringify(PRECACHE_PATHS)};
const SENSITIVE=${JSON.stringify(SENSITIVE_REQUEST_HEADERS)};
const isStatic=(path)=>path.startsWith('/_next/static/')||path.startsWith('/icons/')||path==='/manifest.webmanifest'||path==='/favicon.ico';
const handles=(request)=>{const url=new URL(request.url);return request.method==='GET'&&url.origin===self.location.origin&&!url.pathname.startsWith('/api/')&&!SENSITIVE.some((name)=>request.headers.has(name))&&(request.mode==='navigate'||isStatic(url.pathname)||url.pathname==='/read');};
self.addEventListener('install',(event)=>event.waitUntil(caches.open(CACHE_NAME).then((cache)=>cache.addAll(PRECACHE))));
self.addEventListener('activate',(event)=>event.waitUntil(caches.keys().then((names)=>Promise.all(names.filter((name)=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map((name)=>caches.delete(name)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',(event)=>{const request=event.request;if(!handles(request))return;event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);const url=new URL(request.url);if(request.mode==='navigate'||url.pathname==='/read'){try{return await fetch(request);}catch{const shell=await cache.match(url.pathname==='/read'?'/read':SHELL);if(shell)return shell;throw new TypeError('Offline app shell is unavailable');}}const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok&&response.type!=='opaque')await cache.put(request,response.clone());return response;})());});`;
}
