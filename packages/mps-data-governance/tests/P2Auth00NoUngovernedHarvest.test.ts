import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * ✅ P2-AUTH-00 — NO UNGOVERNED HARVEST PATH.
 *
 *   Invariant under test:
 *     Nothing may read the source registry and fetch from it without going through
 *     `loadVerifiedSourceRegistry()`.
 *
 *   Root cause this closes: `packages/mps-data-governance/scripts/loke-harvest.ts` did exactly
 *   that — `JSON.parse(national-registry.json)` → bare `fetch(endpointUrl)` → `writeFileSync`
 *   into the Master Archive. No attestation check, no allowed_domains, no redirect validation,
 *   no size limit, no retry policy, no quarantine. It was untracked, so it would have been
 *   swept into the repository by any broad `git add`.
 *
 *   It also fabricated provenance: the RawSourceArtifact it wrote carried
 *   `source_registry_ref: { artifact_id, signature: "n/a" }` — an archived object claiming a
 *   registry reference that was never signed.
 *
 *   Two further reasons nothing from it was salvaged: it swallowed every failure into
 *   `console.error` and continued, and its filenames were `data_${Date.now()}`, so a re-run
 *   produced new files instead of recognising the same bytes.
 *
 *   Deleting the file is not the guard — anyone can write it again. This is.
 */
describe("P2-AUTH-00 — no ungoverned harvest path", () => {
  const REPO_ROOT = resolve(__dirname, "../../..");

  const SCANNED_ROOTS = ["scripts", "server", "src", "packages"];
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".tmp", "build"]);

  /** How the registry is named on disk and in configuration. */
  const REGISTRY_REFERENCE = /national-registry\.json|SOURCE_REGISTRY_ARTIFACT_PATH/;

  /** The governed entrypoint. Anything that goes through this is fine by definition. */
  const GOVERNED_LOADER = /loadVerifiedSourceRegistry|getVerifiedSourceDefinition|getAllVerifiedSources/;

  /** A network read. `transport.get` is not matched: that is the governed transport itself. */
  const NETWORK_FETCH = /\bfetch\s*\(|axios\.|got\(|https?\.request\(/;

  /**
   * Contained scripts are exempt, but the containment must be STRUCTURAL, not a comment.
   *
   * Four earlier Loke harvesters (SFS, regulatory, ABVA, court) reference the registry and
   * fetch, and are correctly quarantined: each calls a `never`-returning guard as the FIRST
   * statement of `main()`, so no network call can be reached. A `⛔ QUARANTINED` banner alone
   * would not qualify — a banner does not stop an execution.
   */
  const GUARD_FIRST_IN_MAIN =
    /async function main\s*\(\s*\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*assert\w*Quarantin\w*\s*\(\s*\)\s*;/;
  const GUARD_THROWS = /function assert\w*Quarantin\w*\s*\([^)]*\)\s*:\s*never\s*\{[\s\S]{0,400}?throw /;

  function isStructurallyContained(contents: string): boolean {
    return GUARD_FIRST_IN_MAIN.test(contents) && GUARD_THROWS.test(contents);
  }

  function sourceFiles(): string[] {
    const found: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !/\.test\.|\.spec\./.test(entry)) {
          found.push(full);
        }
      }
    };
    for (const root of SCANNED_ROOTS) walk(join(REPO_ROOT, root));
    return found;
  }

  it("the scan reaches real files, so an empty result cannot pass vacuously", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(
      files.some((f) => f.endsWith(`mps-data-governance${sep}src${sep}SourceRegistry.ts`)),
      "the scan must cover the package that owns the registry contract",
    ).toBe(true);
  });

  it("nothing reads the registry and fetches from it outside the governed loader", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const contents = readFileSync(file, "utf8");
      if (!REGISTRY_REFERENCE.test(contents)) continue;
      if (GOVERNED_LOADER.test(contents)) continue;
      if (!NETWORK_FETCH.test(contents)) continue; // validation-only readers are fine
      if (isStructurallyContained(contents)) continue; // quarantined, guard runs first
      violations.push(relative(REPO_ROOT, file).split(sep).join("/"));
    }

    expect(
      violations,
      "P2-AUTH-00: a file that reads the source registry AND fetches from it, without going " +
        "through loadVerifiedSourceRegistry(), is a second source-authority path. It can " +
        "harvest from entries that were never attested, from domains never approved, with no " +
        "quarantine — while looking like governed collection.",
    ).toEqual([]);
  });

  it("the deleted script cannot return under its own name", () => {
    const revived = sourceFiles().filter((f) =>
      /loke-harvest\.(ts|mjs|js)$/.test(f),
    );

    expect(
      revived.map((f) => relative(REPO_ROOT, f).split(sep).join("/")),
      "P2-AUTH-00: loke-harvest.ts was removed as an alternate authority path. Harvesting " +
        "belongs behind GovernedDownloadExecutor, not in a script that parses the registry as " +
        "plain JSON.",
    ).toEqual([]);
  });

  it("the quarantined Loke harvesters keep their guard as the first statement of main()", () => {
    // These four reference the registry and fetch, so they are only safe while contained.
    // Asserted explicitly: if someone removes a guard, the previous test would silently start
    // reporting the file as a new violation, and it would be easy to read that as a new
    // problem rather than a removed protection.
    const QUARANTINED = [
      "scripts/import/harvest-court-decisions-all.ts",
      "scripts/import/harvest-municipal-abva-all.ts",
      "scripts/import/harvest-regulatory-all.ts",
      "scripts/import/harvest-sfs-all.ts",
    ];

    for (const relPath of QUARANTINED) {
      const full = join(REPO_ROOT, ...relPath.split("/"));
      let contents: string;
      try {
        contents = readFileSync(full, "utf8");
      } catch {
        continue; // deletion is a legitimate outcome; only weakening is not
      }

      expect(
        isStructurallyContained(contents),
        `${relPath}: containment must be structural. The guard has to be the first statement ` +
          "of main() and has to throw — a QUARANTINED banner does not stop an execution.",
      ).toBe(true);
    }
  });

  it("no file fabricates a registry signature", () => {
    const violations: string[] = [];

    for (const file of sourceFiles()) {
      const contents = readFileSync(file, "utf8");
      // The exact shape the deleted script wrote into archived manifests.
      if (/signature\s*:\s*["'`](n\/a|none|unsigned|todo|placeholder)["'`]/i.test(contents)) {
        violations.push(relative(REPO_ROOT, file).split(sep).join("/"));
      }
    }

    expect(
      violations,
      "P2-AUTH-00: an artifact that names a signature it does not have is worse than one with " +
        "no signature field — it reads as attested provenance on inspection.",
    ).toEqual([]);
  });
});
