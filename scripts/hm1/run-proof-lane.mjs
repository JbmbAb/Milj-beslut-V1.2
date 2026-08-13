import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const registryPath = path.join(root, "docs", "architecture", "HM1-PROOF-REGISTRY-2026-08-13.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));

for (const proof of registry.required_proofs) {
  const absolute = path.join(root, proof.file);
  if (!statSync(absolute).isFile()) {
    throw new Error(`HM1 required proof is not a file: ${proof.file}`);
  }
  execFileSync("git", ["ls-files", "--error-unmatch", "--", proof.file], {
    cwd: root,
    stdio: "ignore",
  });
}

const vitestEntrypoint = [root, path.dirname(root)]
  .map((candidate) => path.join(candidate, "node_modules", "vitest", "vitest.mjs"))
  .find((candidate) => existsSync(candidate));
if (!vitestEntrypoint) {
  throw new Error("HM1 proof lane cannot locate the installed Vitest entrypoint");
}
const result = spawnSync(
  process.execPath,
  [
    vitestEntrypoint,
    "run",
    "--config",
    "vitest.config.ts",
    "--project",
    registry.lane.vitest_project,
    ...registry.required_proofs.map((proof) => proof.file),
  ],
  { cwd: root, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
