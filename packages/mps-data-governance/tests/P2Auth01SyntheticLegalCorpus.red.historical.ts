import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("P2-AUTH-01 red proof - synthetic legal corpus contamination", () => {
  it("proves the legacy script can write synthetic sources and manifests into an authoritative archive shape", () => {
    const archiveRoot = mkdtempSync(join(tmpdir(), "p2-auth-01-red-"));
    const scriptPath = resolve(__dirname, "../../../scripts/import/legal-corpus-harvest.ts");

    try {
      execFileSync(process.execPath, ["--import", "tsx", scriptPath], {
        cwd: resolve(__dirname, "../../.."),
        env: { ...process.env, H_DRIVE_ROOT: archiveRoot },
        stdio: "pipe",
        timeout: 30_000,
      });

      const written = readdirSync(archiveRoot, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name));
      const sourceFiles = written.filter((file) => !file.endsWith("manifest.json"));
      const manifests = written.filter((file) => file.endsWith("manifest.json"));

      expect(
        { source_files_written: sourceFiles.length, manifests_written: manifests.length },
        "P2-AUTH-01 VIOLATED: direct execution wrote synthetic legal bytes and provenance-like manifests",
      ).toEqual({ source_files_written: 0, manifests_written: 0 });
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }
  }, 35_000);
});
