"use client";

import { useEffect, useState } from "react";

type DeferredInstallPrompt = Event & {
  prompt(): Promise<unknown>;
};

function isIosSafari(userAgent: string): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function initialMobileViewport(): boolean {
  return typeof window !== "undefined" && (!window.matchMedia || window.matchMedia("(max-width: 700px)").matches);
}

export default function PwaInstallPrompt() {
  const [mobileViewport, setMobileViewport] = useState(initialMobileViewport);
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 700px)");
    const updateViewport = () => setMobileViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!mobileViewport || isStandalone()) return;
    if (isIosSafari(navigator.userAgent)) {
      setIosSafari(true);
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as DeferredInstallPrompt);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, [mobileViewport]);

  async function install(): Promise<void> {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  }

  if (!mobileViewport || installed || isStandalone() || (!iosSafari && !deferredPrompt)) return null;

  return (
    <section className="pwa-install-prompt" aria-label="앱 설치">
      <div>
        <strong>Trance Whale을 홈 화면에 추가하세요</strong>
        {iosSafari
          ? <p>Safari 공유 메뉴에서 홈 화면에 추가를 선택하세요.</p>
          : <p>앱처럼 빠르게 열고, 저장된 책을 오프라인에서도 읽을 수 있어요.</p>}
      </div>
      {!iosSafari && <button type="button" onClick={() => void install()}>앱 설치</button>}
    </section>
  );
}
