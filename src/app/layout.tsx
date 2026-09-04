import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trance Whale — Reader prototype",
  description: "외국어 웹소설을 편안한 한국어로 읽는 리더 UI 프로토타입",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
