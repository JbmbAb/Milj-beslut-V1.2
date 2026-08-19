import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

describe("P2-AUTH-01 - synthetic legal corpus contamination enforcement", () => {
  const repoRoot = resolve(__dirname, "../../..");
  const retiredEntrypoint = resolve(repoRoot, "scripts/import/legal-corpus-harvest.ts");

  it("direct execution of the retired entrypoint cannot write into an authoritative archive shape", () => {
    const archiveRoot = mkdtempSync(join(tmpdir(), "p2-auth-01-green-"));

    try {
      const execution = spawnSync(process.execPath, ["--import", "tsx", retiredEntrypoint], {
        cwd: repoRoot,
        env: { ...process.env, H_DRIVE_ROOT: archiveRoot },
        encoding: "utf8",
        timeout: 10_000,
      });
      const written = readdirSync(archiveRoot, { recursive: true, withFileTypes: true }).filter(
        (entry) => entry.isFile(),
      );

      expect(execution.status).not.toBe(0);
      expect(written).toEqual([]);
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  });

  it("the retired synthetic harvester cannot return under its original path", () => {
    expect(() => statSync(retiredEntrypoint)).toThrow();
  });

  it("no production source can write synthetic legal bytes into an authoritative archive namespace", () => {
    const scannedRoots = ["scripts", "server", "src", "packages"];
    const skippedDirectories = new Set(["node_modules", "dist", ".git", "coverage", "tests"]);
    const violations: string[] = [];

    const walk = (directory: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
        const fullPath = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
          continue;
        }
        if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) || /\.test\.|\.spec\./.test(entry.name)) {
          continue;
        }

        const contents = readFileSync(fullPath, "utf8");
        const fabricatesLegalBytes =
          /Simulate fetch for demonstration|Simulerad PDF|\[Riksdagen Text Data\]/i.test(contents);
        const targetsAuthoritativeArchive = /GEO_Master_Archive|MASTER_ARCHIVE/i.test(contents);
        const writesFiles = /writeFile(?:Sync)?\s*\(/.test(contents);
        const emitsManifest = /manifest\.json|content_bundle_sha256|provenance/i.test(contents);

        if (fabricatesLegalBytes && targetsAuthoritativeArchive && writesFiles && emitsManifest) {
          violations.push(relative(repoRoot, fullPath).split(sep).join("/"));
        }
      }
    };

    for (const root of scannedRoots) walk(resolve(repoRoot, root));

    expect(
      violations,
      "P2-AUTH-01: synthetic legal material must never be written with provenance-like metadata into an authoritative archive namespace",
    ).toEqual([]);
  });
});
