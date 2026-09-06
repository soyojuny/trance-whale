import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Trance Whale",
    short_name: "Trance Whale",
    description: "외국어 웹소설을 자연스러운 한국어로 읽는 PWA 리더",
    start_url: "/",
    display: "standalone",
    theme_color: "#143e3a",
    background_color: "#f6f3eb",
    icons: [
      { src: "/icons/icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/icons/apple-touch-icon.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
    ],
  };
}
