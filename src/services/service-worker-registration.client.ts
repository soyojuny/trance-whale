import "client-only";

type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, "register">;

export async function registerServiceWorker(
  serviceWorker: ServiceWorkerContainerLike,
): Promise<ServiceWorkerRegistration> {
  return serviceWorker.register("/sw.js", { scope: "/" });
}
