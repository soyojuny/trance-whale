"use client";

import { useEffect } from "react";

import {
  registerServiceWorker,
  shouldRegisterServiceWorker,
} from "../services/service-worker-registration.client";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!shouldRegisterServiceWorker() || !("serviceWorker" in navigator)) return;
    void registerServiceWorker(navigator.serviceWorker).catch(() => undefined);
  }, []);

  return null;
}
