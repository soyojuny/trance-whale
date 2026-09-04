import { createServiceWorkerScript } from "../../lib/pwa/service-worker";

export const dynamic = "force-static";

export function GET() {
  return new Response(createServiceWorkerScript(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
