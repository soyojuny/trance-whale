import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { SourceContractError } from "../errors";

export const ALLOWED_SOURCE_HOSTNAMES = ["www.69shuba.com"] as const;

type ResolvedAddress = {
  address: string;
  family: number;
};

export type SourceHostnameResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultResolver: SourceHostnameResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function ipv4ToNumber(address: string): number | undefined {
  if (isIP(address) !== 4) return undefined;

  return address
    .split(".")
    .reduce((value, octet) => value * 256 + Number(octet), 0);
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (value === undefined) return false;

  return !BLOCKED_IPV4_RANGES.some(([network, prefix]) => {
    const blockSize = 2 ** (32 - prefix);
    return Math.floor(value / blockSize) === Math.floor(network / blockSize);
  });
}

function expandIpv6(address: string): number[] | undefined {
  if (isIP(address) !== 6 || address.includes(".")) return undefined;

  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return undefined;

  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;

  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ].map((group) => Number.parseInt(group, 16));

  return groups.length === 8 && groups.every(Number.isInteger) ? groups : undefined;
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return false;

  const first = groups[0];
  const second = groups[1];

  // Globally routable IPv6 unicast space is 2000::/3. Documentation space is
  // syntactically inside it but must never be used as a fetch destination.
  const isGlobalUnicast = first >= 0x2000 && first <= 0x3fff;
  const isBenchmarking = first === 0x2001 && second === 0x0002 && groups[2] === 0;
  const isDocumentation =
    (first === 0x2001 && second === 0x0db8) ||
    (first === 0x3fff && second <= 0x0fff);

  return isGlobalUnicast && !isBenchmarking && !isDocumentation;
}

function isPublicAddress({ address, family }: ResolvedAddress): boolean {
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function validateSourceUrl(
  input: string,
  resolver: SourceHostnameResolver = defaultResolver,
): Promise<URL> {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new SourceContractError("INVALID_URL", "Source URL could not be parsed");
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.port !== ""
  ) {
    throw new SourceContractError("INVALID_URL", "Source URL has forbidden components");
  }

  if (!(ALLOWED_SOURCE_HOSTNAMES as readonly string[]).includes(url.hostname)) {
    throw new SourceContractError("UNSUPPORTED_SITE", "Source hostname is not allowed");
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new SourceContractError("SOURCE_UNREACHABLE", "Source hostname lookup failed");
  }

  if (addresses.length === 0) {
    throw new SourceContractError("SOURCE_UNREACHABLE", "Source hostname has no addresses");
  }

  if (!addresses.every(isPublicAddress)) {
    throw new SourceContractError("SOURCE_BLOCKED", "Source hostname resolved to a blocked address");
  }

  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}
