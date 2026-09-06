import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const SERVER_FILE = /\.server\.[cm]?[jt]sx?$/;
const ROUTE_FILE = /\/route\.[cm]?[jt]sx?$/;
const CLIENT_FILE = /\.client\.[cm]?[jt]sx?$/;
const USE_CLIENT = /^\s*["']use client["'];?/m;
const SERVER_ONLY = /import\s+["']server-only["'];?/;
const SERVER_IMPORT = /(?:\bfrom\s*|\bimport\s*\()\s*["'][^"']+\.server(?:\.[cm]?[jt]sx?)?["']/;
const ENVIRONMENT_VARIABLE = /process\.env\.([A-Z][A-Z0-9_]*)/g;

export function findClientBoundaryViolations(files) {
  const violations = [];

  for (const { path, source } of files) {
    const clientModule = CLIENT_FILE.test(path) || USE_CLIENT.test(source);
    const serverModule = SERVER_FILE.test(path) || ROUTE_FILE.test(path);

    if (SERVER_ONLY.test(source) && !serverModule) {
      violations.push(`${path}: server-only module must use a .server file suffix`);
    }
    if (clientModule && SERVER_IMPORT.test(source)) {
      violations.push(`${path}: client module imports a .server module`);
    }

    for (const match of source.matchAll(ENVIRONMENT_VARIABLE)) {
      const name = match[1];
      if (name !== "NODE_ENV" && !name.startsWith("NEXT_PUBLIC_") && !serverModule) {
        const subject = clientModule ? "client module" : "module";
        violations.push(`${path}: ${subject} reads non-public environment variable ${name}`);
      }
    }
  }

  return violations;
}

function sourceFiles(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, root);
    if (!SOURCE_FILE.test(entry.name)) return [];
    return [{ path: relative(root, path).replaceAll("\\", "/"), source: readFileSync(path, "utf8") }];
  });
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] === scriptPath) {
  const root = join(scriptPath, "..", "..");
  const violations = findClientBoundaryViolations(sourceFiles(join(root, "src"), root));
  if (violations.length > 0) {
    console.error("Client/server boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
    process.exitCode = 1;
  }
}
