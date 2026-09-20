import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1 -- claim 4.
 *
 * The two LU proof scripts enable MPS_LU_BOOTSTRAP_ADMIT=1, which is only acceptable if they can
 * never touch a persistent CAS. They previously opened whatever MIMERS_ROOT the caller had
 * configured. They must now run against an isolated temporary root of their own.
 *
 * The scripts are executed exactly as an operator runs them (a real subprocess, real
 * filesystem-backed Mimers CAS) with MIMERS_ROOT pointing at a sentinel directory that already
 * holds CAS-shaped content. The sentinel must be byte-for-byte unchanged afterwards.
 *
 * Deliberately NOT asserted: the scripts' own "ALL GREEN" verdict. The cold-verify script has an
 * unrelated, pre-existing stale outcome-id assertion (see the unit's completion report); this test
 * proves isolation, not that verdict.
 */

const repoRoot = resolve(process.cwd());

const SCRIPTS = [
  "scripts/ops/prove-lu-replay-cold-verify-01.ts",
  "scripts/ops/prove-lu-deterministic-reexecution-01.ts",
] as const;

/** relative path -> content digest (files) or "<dir>" (directories); recursive, sorted. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const rel = relative(root, full).split(sep).join("/");
      if (statSync(full).isDirectory()) {
        out[rel] = "<dir>";
        walk(full);
      } else {
        out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
      }
    }
  };
  walk(root);
  return out;
}

function operatorEnv(sentinelRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("VITEST") || key.startsWith("MIMERS_") || key === "NODE_ENV") delete env[key];
  }
  delete env.MPS_LU_BOOTSTRAP_ADMIT;
  delete env.LU_MPS_CAS;
  env.MIMERS_ROOT = sentinelRoot;
  return env;
}

interface Isolation {
  readonly root: string;
  readonly mimers_backed: boolean;
  readonly cas_dir_present: boolean;
}

function runScript(script: string, sentinelRoot: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", script], {
    cwd: repoRoot,
    env: operatorEnv(sentinelRoot),
    encoding: "utf8",
    timeout: 170_000,
  });
  const stdout = result.stdout ?? "";
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith("PROOF_ISOLATION "));
  const isolation: Isolation | null = line ? (JSON.parse(line.slice("PROOF_ISOLATION ".length)) as Isolation) : null;
  return { result, stdout, isolation };
}

describe("LU bootstrap proof scripts never touch the caller's MIMERS_ROOT", () => {
  it.each(SCRIPTS)("%s", (script) => {
    const sandbox = mkdtempSync(join(tmpdir(), "lu-r1-sentinel-"));
    const sentinel = join(sandbox, "caller-owned-mimers-root");
    try {
      // CAS-shaped, caller-owned content the proof must neither read, extend nor rewrite.
      mkdirSync(join(sentinel, "cas", "objects"), { recursive: true });
      writeFileSync(join(sentinel, "MARKER"), "caller-owned persistent root");
      writeFileSync(join(sentinel, "cas", "objects", "keep.bin"), "caller-owned object");
      const before = snapshot(sentinel);

      const { result, stdout, isolation } = runScript(script, sentinel);

      // The sentinel is unchanged: nothing added, removed or rewritten anywhere beneath it.
      expect(snapshot(sentinel), `${script}\n${stdout}\n${result.stderr}`).toEqual(before);

      // The proof still ran for real, against a filesystem-backed Mimers CAS at a DISTINCT root.
      expect(isolation, `no PROOF_ISOLATION attestation printed by ${script}`).not.toBeNull();
      const root = isolation!.root;
      const realTmp = realpathSync(tmpdir());
      expect(resolve(root)).not.toBe(resolve(sentinel));
      expect(resolve(root).startsWith(resolve(sentinel) + sep)).toBe(false);
      expect(resolve(root).startsWith(realTmp) || resolve(root).startsWith(resolve(tmpdir()))).toBe(true);
      expect(isolation!.mimers_backed, "must be the real Mimers CAS, not the in-memory shortcut").toBe(true);
      expect(isolation!.cas_dir_present, "CAS directory must exist on disk during the proof").toBe(true);

      // The real assessment in STEP 1 was admitted through the general engine.
      expect(stdout).toMatch(/"originalRunAdmitted": true/);

      // The temporary root is cleaned up once the proof finishes.
      expect(existsSync(root), "isolated temp root must be removed after the proof").toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }, 180_000);
});
