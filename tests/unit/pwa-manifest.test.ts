import { describe, expect, it } from "vitest";

import { metadata } from "../../src/app/layout";
import manifest from "../../src/app/manifest";

describe("PWA manifest", () => {
  it("describes an installable standalone reader with repository icons", () => {
    const value = manifest();

    expect(value).toMatchObject({
      name: "Trance Whale",
      short_name: "Trance Whale",
      start_url: "/",
      display: "standalone",
      theme_color: "#143e3a",
      background_color: "#f6f3eb",
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icons/icon.png", sizes: "1024x1024", type: "image/png" }),
      expect.objectContaining({ src: "/icons/apple-touch-icon.png", sizes: "1024x1024", type: "image/png" }),
    ]));
  });
});

describe("root metadata", () => {
  it("declares the application icon for browser tabs", () => {
    expect(metadata.icons).toEqual({
      icon: [{ url: "/icons/icon.png", type: "image/png", sizes: "1024x1024" }],
      apple: [{ url: "/icons/apple-touch-icon.png", type: "image/png", sizes: "1024x1024" }],
    });
  });
});
