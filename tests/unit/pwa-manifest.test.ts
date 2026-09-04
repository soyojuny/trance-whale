import { describe, expect, it } from "vitest";

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
      expect.objectContaining({ src: "/icons/icon-192.svg", sizes: "192x192" }),
      expect.objectContaining({ src: "/icons/icon-512.svg", sizes: "512x512" }),
    ]));
  });
});
