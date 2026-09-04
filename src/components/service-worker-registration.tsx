"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "../services/service-worker-registration.client";

export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void registerServiceWorker(navigator.serviceWorker).catch(() => undefined);
  }, []);

  return null;
}
