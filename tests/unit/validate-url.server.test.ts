import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SourceContractError } from "../../src/lib/errors";
import {
  validateSourceUrl,
  type SourceHostnameResolver,
} from "../../src/lib/source/validate-url.server";

function resolverFor(...addresses: Array<{ address: string; family: 4 | 6 }>) {
  return vi.fn<SourceHostnameResolver>().mockResolvedValue(addresses);
}

async function expectCode(
  input: string,
  code: SourceContractError["code"],
  resolver = resolverFor({ address: "93.184.216.34", family: 4 }),
) {
  await expect(validateSourceUrl(input, resolver)).rejects.toMatchObject({ code });
}

describe("validateSourceUrl", () => {
  it("accepts the exact allowed hostname with only public DNS results", async () => {
    const resolver = resolverFor(
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    );

    const result = await validateSourceUrl(
      "https://www.69shuba.com:443/txt/48273/32028706?from=catalog",
      resolver,
    );

    expect(result.href).toBe(
      "https://www.69shuba.com/txt/48273/32028706?from=catalog",
    );
    expect(result.username).toBe("");
    expect(result.password).toBe("");
    expect(result.hash).toBe("");
    expect(resolver).toHaveBeenCalledOnce();
    expect(resolver).toHaveBeenCalledWith("www.69shuba.com");
  });

  it.each([
    "https://www.69shuba.com.evil.example/chapter/1",
    "https://evil69shuba.com/chapter/1",
    "https://69shuba.com/chapter/1",
    "https://93.184.216.34/chapter/1",
    "https://localhost/chapter/1",
  ])("rejects an unsupported hostname without resolving it: %s", async (input) => {
    const resolver = resolverFor({ address: "93.184.216.34", family: 4 });

    await expectCode(input, "UNSUPPORTED_SITE", resolver);
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    "not-a-url",
    "http://www.69shuba.com/chapter/1",
    "ftp://www.69shuba.com/chapter/1",
    "https://user:password@www.69shuba.com/chapter/1",
    "https://www.69shuba.com:8443/chapter/1",
    "https://www.69shuba.com/chapter/1#content",
  ])("rejects an invalid source URL without resolving it: %s", async (input) => {
    const resolver = resolverFor({ address: "93.184.216.34", family: 4 });

    await expectCode(input, "INVALID_URL", resolver);
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ["0.0.0.0", 4],
    ["10.0.0.1", 4],
    ["100.64.0.1", 4],
    ["127.0.0.1", 4],
    ["169.254.1.1", 4],
    ["172.16.0.1", 4],
    ["192.0.2.1", 4],
    ["192.168.0.1", 4],
    ["198.18.0.1", 4],
    ["198.51.100.1", 4],
    ["203.0.113.1", 4],
    ["224.0.0.1", 4],
    ["240.0.0.1", 4],
    ["::", 6],
    ["::1", 6],
    ["::ffff:192.168.0.1", 6],
    ["fc00::1", 6],
    ["fe80::1", 6],
    ["ff02::1", 6],
    ["2001:2::1", 6],
    ["2001:db8::1", 6],
    ["3fff::1", 6],
  ] as const)("rejects a non-public DNS address: %s", async (address, family) => {
    await expectCode(
      "https://www.69shuba.com/chapter/1",
      "SOURCE_BLOCKED",
      resolverFor({ address, family }),
    );
  });

  it("rejects all DNS results when any IPv4 or IPv6 result is non-public", async () => {
    await expectCode(
      "https://www.69shuba.com/chapter/1",
      "SOURCE_BLOCKED",
      resolverFor(
        { address: "93.184.216.34", family: 4 },
        { address: "2001:db8::1", family: 6 },
      ),
    );
  });

  it("maps DNS failures and empty DNS results to SOURCE_UNREACHABLE", async () => {
    const failedResolver = vi
      .fn<SourceHostnameResolver>()
      .mockRejectedValue(new Error("DNS details must remain internal"));

    await expectCode(
      "https://www.69shuba.com/chapter/1",
      "SOURCE_UNREACHABLE",
      failedResolver,
    );
    await expectCode(
      "https://www.69shuba.com/chapter/1",
      "SOURCE_UNREACHABLE",
      resolverFor(),
    );
  });
});
