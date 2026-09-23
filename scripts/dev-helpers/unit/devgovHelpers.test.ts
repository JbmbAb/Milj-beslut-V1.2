import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * DEV-HELPERS (advisory, not an authority): lint + preflight for DEV-GOV unit definitions.
 *
 * Each rule is proven against a small throwaway git repository holding a KNOWN defect taken from
 * LU-CANONICAL-RUNTIME-HARDENING-R1, so a rule cannot pass by matching nothing. The temporary
 * repositories never touch the real repository, and the tests need no network.
 */

const lib: any = await import("../lib/unitLint.mjs");
const closure: any = await import("../lib/importClosure.mjs");
const preflight: any = await import("../lib/preflight.mjs");
const { lintUnitDefinition } = lib;
const { fsReader, gitReader, maskSource, findRuntimeReach, loadAliases } = closure;

const HELPER_CLI = resolve(process.cwd(), "scripts/dev-helpers/devgov-helper.mjs");
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};

function write(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

const DEF_PATH = "governance/devgov/units/x-v1.json";

/** Base commit: a repo where `packages/a` (transitively) loads server/db/prisma.ts and `packages/b` does not. */
function makeRepo() {
  // realpath: the controller compares `git rev-parse --show-toplevel` with this path (8.3 short names on Windows)
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "devgov-helpers-")));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.invalid");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "core.autocrlf", "false");
  write(dir, {
    ".gitignore": "*.json\n!tsconfig.json\n",
    "tsconfig.json": '{ "compilerOptions": { "paths": { "@miljobeslut/a": ["./packages/a/src/index.ts"], "@miljobeslut/a/*": ["./packages/a/*"] } } }\n',
    "server/db/prisma.ts": "export { Prisma } from '@prisma/client';\nexport const prisma = {};\n",
    "packages/a/src/index.ts": "import { prisma } from '../../../server/db/prisma';\nexport const a = prisma;\n",
    "packages/a/src/a.test.ts": "import { a } from './index';\nvoid a;\n",
    "packages/mocked/src/m.test.ts": "vi.mock('../../../server/db/prisma', () => ({}));\nimport { a } from '../../a/src/index';\nvoid a;\n",
    "packages/b/src/index.ts": "export const b = 1;\n",
    "packages/typeonly/src/index.ts": "import type { Prisma } from '@prisma/client';\nexport type T = Prisma.JsonValue;\n",
    // import-looking text that is NOT an import: a string fixture and a template literal
    "packages/strfix/src/index.ts": "export const fx = 'import { prisma } from \"../../../server/db/prisma\";';\nexport const tpl = `\nimport { prisma } from '../../../server/db/prisma';\n`;\n// import { prisma } from '../../../server/db/prisma';\n",
    "packages/alias/src/index.ts": "import { a } from '@miljobeslut/a';\nexport const x = a;\n",
    "scripts/ops/runner.ts": "import { a } from '../../packages/a/src/index';\nvoid a;\n",
    "scripts/ops/spawner.test.ts": "const SCRIPTS = ['scripts/ops/runner.ts'];\nvoid SCRIPTS;\n",
  });
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD");
  return { dir, base };
}

const RED_OK = {
  id: "red-ok",
  command: "node",
  args: ["-e", "try { process.exit(require('node:fs').existsSync('marker.txt') ? 0 : 1); } catch (e) { process.exit(2); }"],
  expected_classification: "FAIL",
  required_head: "base_sha",
  blocked_exit_codes: [2],
  timeout_ms: 60000,
};
const GREEN_OK = { ...RED_OK, id: "green-ok", expected_classification: "PASS", required_head: "candidate_sha" };

function def(base: string, over: Record<string, unknown> = {}) {
  return {
    schema_version: "dev-gov-v1-unit-definition",
    unit: "X-V1",
    role: "producer",
    mode: "writer",
    branch: "unit/x",
    base_sha: base,
    ancestry_policy: "descendant_of_base",
    allowed_paths: [DEF_PATH, "marker.txt", "docs/architecture/audits/X.md"],
    forbidden_paths: [".github/**", "scripts/devgov/**", "governance/devgov/schema/**"],
    required_red: [RED_OK],
    required_green: [GREEN_OK],
    ...over,
  };
}

function lint(repo: { dir: string; base: string }, d: any) {
  return lintUnitDefinition(d, {
    definitionPath: DEF_PATH,
    head: fsReader(repo.dir),
    base: gitReader(repo.dir, repo.base),
  });
}
const ids = (findings: any[], severity?: string) => findings.filter((f) => !severity || f.severity === severity).map((f) => f.id);
const red = (over: Record<string, unknown>) => ({ ...RED_OK, ...over });

describe("importClosure: maskSource", () => {
  it("blanks strings, templates and comments but keeps import specifiers", () => {
    const masked = maskSource("import { a } from './real';\nconst s = 'import x from \"./fake\"';\nconst t = `import y from './fake2'`;\n// import z from './fake3'\nconst d = await import('./dyn');\n");
    expect(masked).toContain("'./real'");
    expect(masked).toContain("'./dyn'");
    expect(masked).not.toContain("fake");
  });
});

describe("importClosure: findRuntimeReach", () => {
  const repo = makeRepo();
  const reader = gitReader(repo.dir, repo.base);
  const aliases = loadAliases(reader);
  const targets = { fileTargets: /(^|\/)server\/db\/prisma\.ts$/, bareTargets: /^@prisma\/client/ };

  it("follows relative imports and reports the whole chain", () => {
    const hit = findRuntimeReach({ seeds: ["packages/a/src/index.ts"], reader, aliases, ...targets });
    expect(hit).toMatchObject({ kind: "file", hit: "server/db/prisma.ts" });
    expect(hit.chain).toEqual(["packages/a/src/index.ts", "server/db/prisma.ts"]);
  });
  it("resolves tsconfig path aliases", () => {
    const hit = findRuntimeReach({ seeds: ["packages/alias/src/index.ts"], reader, aliases, ...targets });
    expect(hit?.chain).toEqual(["packages/alias/src/index.ts", "packages/a/src/index.ts", "server/db/prisma.ts"]);
  });
  it("ignores type-only imports, string fixtures, templates and comments", () => {
    for (const seed of ["packages/typeonly/src/index.ts", "packages/strfix/src/index.ts", "packages/b/src/index.ts"]) {
      expect(findRuntimeReach({ seeds: [seed], reader, aliases, ...targets }), seed).toBeNull();
    }
  });
  it("reads the same answer from a working tree and from a git tree", () => {
    const fromFs = findRuntimeReach({ seeds: ["packages/a/src/index.ts"], reader: fsReader(repo.dir), aliases, ...targets });
    expect(fromFs?.hit).toBe("server/db/prisma.ts");
  });
});

describe("unit lint: rules, each proven on a known defect", () => {
  const repo = makeRepo();
  // candidate commit: files that exist only at the candidate
  write(repo.dir, { "marker.txt": "x\n", "packages/new/src/only-on-candidate.ts": "export const n = 1;\n" });

  it("a clean definition has no ERROR and no WARN", () => {
    const f = lint(repo, def(repo.base));
    expect(ids(f, "ERROR")).toEqual([]);
    expect(ids(f, "WARN")).toEqual([]);
  });

  it("DGL-001/002/003/012: structure, own path lock, protected paths, RED+GREEN present", () => {
    expect(ids(lint(repo, def(repo.base, { allowed_paths: ["marker.txt"] })), "ERROR")).toContain("DGL-002");
    expect(ids(lint(repo, def(repo.base, { forbidden_paths: [".github/**"] })), "ERROR")).toContain("DGL-003");
    expect(ids(lint(repo, def(repo.base, { required_red: [] })), "ERROR")).toContain("DGL-012");
    expect(ids(lint(repo, def(repo.base, { required_green: [GREEN_OK, GREEN_OK] })), "ERROR")).toContain("DGL-012");
    expect(ids(lint(repo, def(repo.base, { base_sha: "nothex" })), "ERROR")).toContain("DGL-001");
  });

  it("DGL-010/011: RED must run at base and FAIL; GREEN at candidate and PASS", () => {
    expect(ids(lint(repo, def(repo.base, { required_red: [red({ required_head: "candidate_sha" })] })), "ERROR")).toContain("DGL-010");
    expect(ids(lint(repo, def(repo.base, { required_red: [red({ expected_classification: "PASS" })] })), "ERROR")).toContain("DGL-010");
    expect(ids(lint(repo, def(repo.base, { required_green: [{ ...GREEN_OK, required_head: "base_sha" }] })), "ERROR")).toContain("DGL-011");
  });

  it("DGL-020: a RED without blocked_exit_codes would count a crash as a valid RED", () => {
    const f = lint(repo, def(repo.base, { required_red: [red({ blocked_exit_codes: undefined })] }));
    expect(ids(f, "ERROR")).toContain("DGL-020");
  });

  it("DGL-021: a RED that runs git is rejected", () => {
    const f = lint(repo, def(repo.base, { required_red: [red({ args: ["-e", "require('node:child_process').spawnSync('git', ['show', 'HEAD~1'])"] })] }));
    expect(ids(f, "ERROR")).toContain("DGL-021");
  });

  it("DGL-022: a RED naming a candidate-only file warns; explicit ENOENT handling downgrades it to INFO", () => {
    const missing = red({ args: ["-e", "require('node:fs').readFileSync('packages/new/src/only-on-candidate.ts')"] });
    const warned = lint(repo, def(repo.base, { required_red: [missing] }));
    expect(ids(warned, "WARN")).toContain("DGL-022");
    const handled = red({ args: ["-e", "try { require('node:fs').readFileSync('packages/new/src/only-on-candidate.ts'); } catch (e) { if (e.code === 'ENOENT') process.exit(1); process.exit(2); }"] });
    const info = lint(repo, def(repo.base, { required_red: [handled] }));
    expect(ids(info, "WARN")).not.toContain("DGL-022");
    expect(ids(info, "INFO")).toContain("DGL-022");
  });

  it("DGL-030: npx cannot be spawned without a shell on Windows", () => {
    const f = lint(repo, def(repo.base, { required_green: [{ ...GREEN_OK, command: "npx", args: ["vitest", "run"] }] }));
    expect(ids(f, "WARN")).toContain("DGL-030");
  });

  it("DGL-031: a natively executed program that loads server/db/prisma.ts is an ERROR", () => {
    const f = lint(repo, def(repo.base, { required_red: [red({ args: ["-e", "await import('./packages/a/src/index.ts')"] })] }));
    const hit = f.find((x: any) => x.id === "DGL-031");
    expect(hit).toMatchObject({ severity: "ERROR", kind: "gate" });
    expect(hit.message).toContain("packages/a/src/index.ts -> server/db/prisma.ts");
  });

  it("DGL-031: provisioning inside the command, or an import that never reaches prisma, is clean", () => {
    const provisioned = red({ timeout_ms: 400000, args: ["-e", "require('node:child_process').spawnSync('npx', ['prisma', 'generate']); await import('./packages/a/src/index.ts')"] });
    expect(ids(lint(repo, def(repo.base, { required_red: [provisioned] })))).not.toContain("DGL-031");
    for (const path of ["packages/b/src/index.ts", "packages/typeonly/src/index.ts", "packages/strfix/src/index.ts"]) {
      const f = lint(repo, def(repo.base, { required_red: [red({ args: ["-e", `await import('./${path}')`] })] }));
      expect(ids(f), path).not.toContain("DGL-031");
    }
  });

  it("DGL-031: reading a source file as TEXT inside an inline program is not an import", () => {
    const readsOnly = red({ args: ["-e", "require('node:fs').readFileSync('packages/a/src/index.ts', 'utf8')"] });
    expect(ids(lint(repo, def(repo.base, { required_red: [readsOnly] })))).not.toContain("DGL-031");
  });

  it("DGL-031: a vitest test that reaches prisma is only a WARN (unverified), and vi.mock of prisma is clean", () => {
    const viaVitest = { ...GREEN_OK, command: "node", args: ["vitest-stub.mjs", "packages/a/src/a.test.ts", "vitest"] };
    const warned = lint(repo, def(repo.base, { required_green: [viaVitest] }));
    expect(warned.find((x: any) => x.id === "DGL-031")).toMatchObject({ severity: "WARN" });
    const mocked = { ...GREEN_OK, args: ["vitest-stub.mjs", "packages/mocked/src/m.test.ts", "vitest"] };
    expect(ids(lint(repo, def(repo.base, { required_green: [mocked] })))).not.toContain("DGL-031");
  });

  it("DGL-032: a test that only NAMES a script which loads prisma is flagged for review", () => {
    const spawner = { ...GREEN_OK, command: "node", args: ["vitest-stub.mjs", "scripts/ops/spawner.test.ts", "vitest"] };
    const f = lint(repo, def(repo.base, { required_green: [spawner] }));
    expect(f.find((x: any) => x.id === "DGL-032")).toMatchObject({ severity: "WARN" });
  });

  it("DGL-040: process.exit inside try skips finally and leaks a mkdtemp sandbox; cleaning first is accepted", () => {
    const leaky = red({ args: ["-e", "const d = require('node:fs').mkdtempSync('x'); try { process.exit(1); } finally { require('node:fs').rmSync(d); }"] });
    expect(ids(lint(repo, def(repo.base, { required_red: [leaky] })), "WARN")).toContain("DGL-040");
    const careful = red({ args: ["-e", "const d = require('node:fs').mkdtempSync('x'); const clean = () => require('node:fs').rmSync(d); const V = (m) => { clean(); process.exit(1); }; try { V('x'); } finally { clean(); }"] });
    expect(ids(lint(repo, def(repo.base, { required_red: [careful] })))).not.toContain("DGL-040");
  });

  it("DGL-050: a packaging unit must not carry a PROVEN record", () => {
    write(repo.dir, { "docs/architecture/audits/X.md": "# X\n\n**Final state:** PROVEN\n" });
    expect(ids(lint(repo, def(repo.base)), "ERROR")).toContain("DGL-050");
    write(repo.dir, { "docs/architecture/audits/X.md": `# X CANDIDATE\n\nBase ${repo.base}\n\n## Non-claims\n\nnone\n` });
    expect(ids(lint(repo, def(repo.base)), "ERROR")).not.toContain("DGL-050");
    expect(ids(lint(repo, def(repo.base)), "WARN")).not.toContain("DGL-050");
  });

  it("every finding carries a kind and the kinds are the documented three", () => {
    const f = lint(repo, def(repo.base, { required_red: [red({ blocked_exit_codes: undefined })], forbidden_paths: [] }));
    expect(new Set(f.map((x: any) => x.kind))).toEqual(new Set(["proof-validity", "hygiene"]));
  });
});

describe("preflight: wraps the controller and adds what it does not tell you early", () => {
  function candidateRepo(opts: { untrackedDef?: boolean; extraPath?: string } = {}) {
    const repo = makeRepo();
    git(repo.dir, "checkout", "-q", "-b", "unit/x");
    write(repo.dir, { "marker.txt": "x\n", ...(opts.extraPath ? { [opts.extraPath]: "z\n" } : {}) });
    const d = def(repo.base);
    write(repo.dir, { [DEF_PATH]: JSON.stringify(d, null, 2) });
    git(repo.dir, "add", "marker.txt");
    if (opts.extraPath) git(repo.dir, "add", opts.extraPath);
    if (!opts.untrackedDef) git(repo.dir, "add", "-f", DEF_PATH);
    git(repo.dir, "commit", "-q", "-m", "candidate");
    return repo;
  }
  const run = (repo: { dir: string }, extra: Record<string, unknown> = {}) =>
    preflight.runPreflight({ worktree: repo.dir, definition: DEF_PATH, remote: false, ...extra });

  it("a well-formed candidate has no ERROR and reports a static verdict", () => {
    const report = run(candidateRepo());
    expect(report.findings.filter((f: any) => f.severity === "ERROR")).toEqual([]);
    expect(report.verdict).toBe("NO_ERRORS_FOUND_STATIC");
    expect(report.findings.map((f: any) => f.id)).toContain("PRE-APPROVALS");
  });

  it("a definition ignored by .gitignore and not committed is caught before push (PRE-IGNORE + controller provenance)", () => {
    const report = run(candidateRepo({ untrackedDef: true }));
    const found = report.findings.map((f: any) => f.id);
    expect(found).toContain("PRE-IGNORE");
    expect(found).toContain("CTL-DEF");
    expect(report.verdict).toBe("LIKELY_TO_FAIL");
  });

  it("a changed path outside allowed_paths is reported from the controller's own path lock", () => {
    const report = run(candidateRepo({ extraPath: "src/outside.ts" }));
    const ctl = report.findings.filter((f: any) => f.id === "CTL-REPO").map((f: any) => f.message).join(" | ");
    expect(ctl).toContain("NOT_ALLOWED: src/outside.ts");
  });

  it("a dirty tree is reported", () => {
    const repo = candidateRepo();
    write(repo.dir, { "stray.txt": "dirty\n" });
    const ctl = run(repo).findings.filter((f: any) => f.id === "CTL-REPO" || f.id === "CTL-DEF").map((f: any) => f.message).join(" | ");
    expect(ctl).toMatch(/dirty|clean/);
  });

  it("--execute dry-runs RED at the base worktree and GREEN at the candidate with the controller's runner", () => {
    const repo = candidateRepo();
    const baseWt = `${repo.dir}-base`;
    dirs.push(baseWt);
    git(repo.dir, "worktree", "add", "--detach", baseWt, repo.base);
    const report = run(repo, { execute: true, baseWorktree: baseWt });
    expect(report.results.map((r: any) => [r.kind, r.observed, r.ok])).toEqual([
      ["RED", "FAIL", true],
      ["GREEN", "PASS", true],
    ]);
    expect(report.verdict).toBe("LIKELY_TO_PASS_DRY_RUN_OK");
  });

  it("without --base-worktree the RED is skipped and reported, never silently treated as passed", () => {
    const repo = candidateRepo();
    const report = run(repo, { execute: true }); // no --base-worktree: RED is skipped, never silently passed
    expect(report.findings.map((f: any) => f.id)).toContain("EXE-SKIP");
    expect(report.results.every((r: any) => r.kind === "GREEN")).toBe(true);
  });
});

describe("CLI", () => {
  const cli = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [HELPER_CLI, ...args], { cwd, encoding: "utf8" });

  it("exit 0 on a clean definition, exit 1 on an ERROR, exit 2 on misuse; always says it is advisory", () => {
    const repo = makeRepo();
    write(repo.dir, { [DEF_PATH]: JSON.stringify(def(repo.base), null, 2) });
    const ok = cli(repo.dir, "lint", DEF_PATH);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("advisory only");

    write(repo.dir, { [DEF_PATH]: JSON.stringify(def(repo.base, { required_red: [red({ blocked_exit_codes: undefined })] }), null, 2) });
    const bad = cli(repo.dir, "lint", DEF_PATH);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("DGL-020");
    expect(cli(repo.dir, "lint", DEF_PATH, "--ignore", "DGL-020").status).toBe(0);

    const json = JSON.parse(cli(repo.dir, "lint", DEF_PATH, "--json").stdout);
    expect(json.findings[0]).toHaveProperty("kind");

    expect(cli(repo.dir).status).toBe(2);
    expect(cli(repo.dir, "lint", "does-not-exist.json").status).toBe(2);
  });
});
