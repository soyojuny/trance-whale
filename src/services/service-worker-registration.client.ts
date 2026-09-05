import "client-only";

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, "register">;

export function shouldRegisterServiceWorker(environment = process.env.NODE_ENV): boolean {
  return environment === "production";
}

export async function registerServiceWorker(
  serviceWorker: ServiceWorkerContainerLike,
): Promise<ServiceWorkerRegistration> {
  return serviceWorker.register("/sw.js", { scope: "/" });
}
