import { describe, expect, it } from "vitest";

import { findClientBoundaryViolations } from "../../scripts/check-client-boundaries.mjs";

describe("client boundary policy", () => {
  it("rejects client imports of server modules and non-public environment variables", () => {
    const violations = findClientBoundaryViolations([
      {
        path: "src/components/home.client.tsx",
        source: "\"use client\"; import { cache } from \"../lib/pwa/config.server\"; const id = process.env.PWA_BUILD_ID;",
      },
    ]);

    expect(violations).toEqual([
      "src/components/home.client.tsx: client module imports a .server module",
      "src/components/home.client.tsx: client module reads non-public environment variable PWA_BUILD_ID",
    ]);
  });

  it("requires server-only modules to use the server filename suffix", () => {
    expect(findClientBoundaryViolations([
      { path: "src/lib/pwa/config.ts", source: "import \"server-only\";" },
    ])).toEqual([
      "src/lib/pwa/config.ts: server-only module must use a .server file suffix",
    ]);
  });

  it("allows public browser variables and correctly named server modules", () => {
    expect(findClientBoundaryViolations([
      { path: "src/services/theme.client.ts", source: "const name = process.env.NEXT_PUBLIC_APP_NAME;" },
      { path: "src/lib/pwa/config.server.ts", source: "import \"server-only\"; const id = process.env.PWA_BUILD_ID;" },
    ])).toEqual([]);
  });
});
