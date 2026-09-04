import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistration from "../components/service-worker-registration";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trance Whale",
  description: "외국어 웹소설을 자연스러운 한국어로 읽는 PWA 리더",
  applicationName: "Trance Whale",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
  },
  appleWebApp: { capable: true, title: "Trance Whale", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#143e3a" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}<ServiceWorkerRegistration /></body>
    </html>
  );
}
