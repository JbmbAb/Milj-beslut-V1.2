/**
 * U30F2 H1 (PRES-05) -- channel-based DEFAULT-DENY inventory of protected relation writes.
 *
 * The U30F F1 inventory looked for destructive keywords near protected names in scripts/, packages/
 * and server/; the verifier's 31 canaries showed it missed 23 (SQL in a variable, a line break, upper
 * case, a test/ or dot directory, a name from a registry or argv, concatenation, PGDump + psql -f,
 * shp2pgsql | psql, pg_restore --clean, ALTER SCHEMA RENAME, DROP OWNED, a .cmd wrapper, pool.query,
 * ogrinfo -sql, a differently named GDAL binary, Python and PowerShell variants).
 *
 * This inventory walks the WHOLE repository (PATH_EXCLUSIONS aside) and reads every file that can run
 * code: TS/JS, Python, PowerShell, shell, cmd/bat, SQL, YAML (CI, compose, cloudbuild), TOML, Dockerfiles
 * and package.json scripts (tests/unit/protectedWriteChannels.ts). Every CHANNEL -- a database client
 * call, a process call, a command line, a SQL file -- and every string literal is classified by the
 * gate's own classifier. A file passes only when each of its sites is
 *   - gated (inside or bound to a gate call, or a dynamic target a preceding relation gate checked),
 *   - statically ALLOWED (reads, or writes no protected relation),
 *   - in a retired script (RETIRED_DESTRUCTIVE_SCRIPTS, refused before anything runs),
 *   - in a pinned historical migration (HISTORICAL_SQL, by content hash), or
 *   - listed EXACTLY in REVIEWED_CHANNELS with a justification (a PROTECTED site only under a policy that
 *     allows it: governed, sanctioned rebuild, test-database guard, gated via, separately guarded).
 * Everything else fails: a new channel, a new dynamic site, a changed excerpt, a stale entry. The lists
 * are pinned by count and sha256 below, so none of them grows (or changes) without a reviewed edit here.
 *
 * Generality: every one of the verifier's 31 canaries must be caught, and a seeded generator writes
 * hundreds of new violations (languages x channels x relations x obfuscations x paths) that must all be
 * caught -- and as many statically allowed controls that must not be.
 *
 * Read-only: no database, no process; the canaries never touch the disk (their content is scanned in
 * memory, against the real repository).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splitCommandLine } from '../../packages/spatial-provider-postgis/src/ProtectedWriteClassifier';
import { SPATIAL_LAYER_REGISTRY } from '../../packages/spatial-provider-postgis/src/SpatialLayerRegistry';
import {
  PROTECTED_RELATIONS,
  parseProtectedRelationsDefinition,
  type ProtectedRelationsDefinition,
} from '../../packages/spatial-provider-postgis/src/ProtectedRelations';
import {
  RETIRED_DESTRUCTIVE_SCRIPTS,
  validateRetiredDestructiveScripts,
} from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';
import { commandRuns, languageOf, scanFile, walkRepository, type ChannelSite, type FileScan, type Language, type Launch } from './protectedWriteChannels';
import * as channels from './protectedWriteChannels';
import {
  FILE_TYPE_DECISIONS,
  GATE_IMPLEMENTATION,
  HISTORICAL_SQL,
  PATH_EXCLUSIONS,
  REVIEWED_CHANNELS,
  REVIEW_MARKER_DOORS,
  TEST_SOURCES,
  UNSCANNED_EXECUTABLES,
  UNSCANNED_EXECUTABLE_TYPES,
  type ReviewedChannels,
} from './protectedWriteChannels.reviewed';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------------------------
// Locks: every reviewed list is pinned. A change of a list is a reviewed change of this file too.
// ---------------------------------------------------------------------------------------------

const LOCKS = {
  reviewedEntries: 60,
  reviewedSites: 133,
  reviewedSha256: '3db8b7e492e7cf2632859d5e77a9343a51e27b3a87b72c6a0fc37c8708e1b218',
  historicalFiles: 10,
  historicalSha256: 'a1ac41e6db406040b8cd6226c3701534a8bedd97ebc03add995f44661c29a19c',
  gateImplementationSha256: '8e4c1728b341ad514847e9cb4e2e9f4046607f95d059c9a87c119ac505ce98bd',
  pathExclusionsSha256: '4becd2b0307d48979f6cd9428aa35b4fff76df21c9bcd571effefaf2a67583f7',
  unscannedSha256: 'f860776a464e23399d4f996737d917154ef3cc12cd3a7f56b2e834d65d24fddd',
  testSourcesSha256: '42f868346e882e2a4a9cc20db07e20782b24e553633d550933d1aeff815a67d5',
  retiredCount: 18,
  // U30F2 LOW (verifier L3): the retired list is pinned by content too -- an entry swapped for another
  // with the same count, or an entry's relations, justification or replacement changed, fails here.
  retiredSha256: '95a7f253f4e39e1c8d3aed638ab5b71abda678a44d4a1f6bfe56c8793381b645',
  // U30F3 (verifier L-1): the closed list of gate doors a reviewed marker may name
  markerDoorsSha256: '806f99ebb2450096d501ba639356a17768d989e541c3a630c98d7ca04bab32a6',
  // U30F4 (B5): the file types decided to be data
  fileTypeDecisionsSha256: '490bbe38db7f2569773f3de5140e8135271c9bce57a5bbfd4e1578ed2819aa40',
  // U30F5 (D-7): the open owner decisions (BLOCKERARE, failed by their own test)
  openDecisionsSha256: '8b758f120f081e399f40afb73a84749980fa4d0a3edf8a5d413d5ea7958ad343',
} as const;

function sha256Of(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// ---------------------------------------------------------------------------------------------
// Repository walk and evaluation
// ---------------------------------------------------------------------------------------------

// A runner include glob as a regular expression: a double-star segment is any directories, `*` stays within one segment.
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**/', i)) {
      out += '(?:.*/)?';
      i += 2;
    } else if (glob[i] === '*') out += '[^/]*';
    else out += glob[i]!.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}
// U30F3 M-2: a test source is a file a configured runner runs (its include globs), not a name or a directory
const TEST_RUNNER_GLOBS = TEST_SOURCES.runners.flatMap((r) => r.globs.map(globToRegExp));
const TEST_RUNNER_EXCLUDED = new Set<string>(TEST_SOURCES.excluded.map((e) => e.file));
const TEST_SOURCE = { test: (rel: string): boolean => !TEST_RUNNER_EXCLUDED.has(rel) && TEST_RUNNER_GLOBS.some((re) => re.test(rel)) };
const EXCLUDED = PATH_EXCLUSIONS.map((e) => new RegExp(e.pattern));
const GATE_FILES = new Set(GATE_IMPLEMENTATION.map((g) => g.file));

/** A repository path the inventory scans (not excluded, not a test source, a scanned language). */
export function isScannedPath(rel: string): boolean {
  return !EXCLUDED.some((re) => re.test(rel)) && !TEST_SOURCE.test(rel) && languageOf(rel) !== null;
}

function readRepo(root: string): (p: string) => string | null {
  return (p) => {
    try {
      return fs.readFileSync(path.join(root, p), 'utf8');
    } catch {
      return null;
    }
  };
}

function siteKey(s: ChannelSite): string {
  return `${s.verdict} ${s.kind} ${s.channel} | ${s.excerpt}`;
}

function normalisedSha(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

interface EvaluationContext {
  readonly retired: ReadonlySet<string>;
  readonly reviewed: ReadonlyMap<string, ReviewedChannels>;
  readonly historical: ReadonlyMap<string, (typeof HISTORICAL_SQL)[number]>;
  readonly definition: ProtectedRelationsDefinition;
  /** Non-test files that import each module basename (for `callers` entries). */
  readonly importersOf: (file: string) => string[];
  /** U30F3 M-2: scanned files that import the file by a relative path that resolves to it, or name its path or file name. */
  readonly reachersOf: (file: string) => string[];
}

const TEST_TREE = /^(tests|packages\/[^/]+\/tests)\//;
const RUNNER_CONFIGS = new Set<string>([...TEST_SOURCES.runners, ...TEST_SOURCES.excluded].map((r) => r.config));

/**
 * U30F3 M-2 (TEST_HARNESS): why a file in a test tree is reached from outside the test trees, or null. Every scanned
 * file that imports or names it must itself be in a test tree and reached the same way (recursively), or be a test
 * runner configuration; test sources are run by their runner and are not scanned, so they never appear here.
 */
function testHarnessReach(file: string, ctx: EvaluationContext, seen: Set<string> = new Set()): string | null {
  if (seen.has(file)) return null;
  seen.add(file);
  for (const r of ctx.reachersOf(file)) {
    if (RUNNER_CONFIGS.has(r)) continue;
    if (!TEST_TREE.test(r)) return `reached from ${r}, outside the test trees`;
    const deeper = testHarnessReach(r, ctx, seen);
    if (deeper) return `${deeper} (via ${r})`;
  }
  return null;
}

interface Problem {
  readonly file: string;
  readonly problem: string;
  /** U30F5 (D-7): a site of OPEN_OWNER_DECISIONS -- failed by its own BLOCKERARE test, not by every other one. */
  readonly open?: true;
}

/**
 * U30F5 (D-7): the pre-existing CASCADE sites the new rule (a CASCADE outside the gate is UNRESOLVABLE) found in operator
 * scripts. They are NOT reviewed -- nothing shows them unreachable -- and NOT changed here (operator scripts are outside
 * this unit). Each awaits an owner decision: drop the CASCADE (PostgreSQL then refuses to drop a dependent object), gate
 * the statement (the gate judges its named targets) or retire the script. Until then the BLOCKERARE test below fails on
 * exactly these sites; every other test sees them as known, so a NEW site in these files still fails as before. A site
 * is matched with its detail too: an open site whose verdict gains another reason is new.
 */
const OPEN_OWNER_DECISIONS: Readonly<Record<string, readonly string[]>> = {
  'scripts/db/cleanup-db.ts': [
    'CASCADE :: UNRESOLVABLE SQL_TEXT literal | `DROP TABLE IF EXISTS "${table}" CASCADE`',
    'CASCADE :: UNRESOLVABLE SQL_CALL prisma.$executeRawUnsafe | prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`)',
  ],
  'scripts/import/fill-empty-gaps-from-archive.ts': ["CASCADE :: UNRESOLVABLE SQL_TEXT literal | 'DROP TABLE IF EXISTS env.friluftsliv CASCADE;'"],
  'scripts/import/sanitize-postgis-failed-imports.ps1': [
    'CASCADE, DROP :: UNRESOLVABLE SQL_TEXT literal | "DROP TABLE IF EXISTS $t CASCADE;"',
    'CASCADE, DROP :: UNRESOLVABLE SQL_TEXT literal | "DROP TABLE IF EXISTS $t CASCADE;"',
    "CASCADE :: UNRESOLVABLE SQL_TEXT literal | 'DROP SCHEMA IF EXISTS stage CASCADE;'",
    "CASCADE :: UNRESOLVABLE SQL_TEXT literal | 'DROP SCHEMA IF EXISTS transport CASCADE;'",
  ],
};

/** The key of an open site: its detail (the verdict's reasons) and its site key. */
function openKey(s: ChannelSite): string {
  return `${s.detail} :: ${siteKey(s)}`;
}

/** The sites of a scan minus the open ones of OPEN_OWNER_DECISIONS (as multisets, matched by openKey). */
function splitOpen(file: string, sites: readonly ChannelSite[]): { open: ChannelSite[]; rest: ChannelSite[] } {
  const left = [...(OPEN_OWNER_DECISIONS[file] ?? [])];
  const open: ChannelSite[] = [];
  const rest: ChannelSite[] = [];
  for (const s of sites) {
    const at = left.indexOf(openKey(s));
    if (at >= 0) {
      left.splice(at, 1);
      open.push(s);
    } else rest.push(s);
  }
  return { open, rest };
}

/** A retired script refuses before anything runs (TS: its refusal call first; SQL: the refusal header). */
function retiredRefusesFirst(file: string, text: string): string | null {
  const code = text.replace(/\r\n/g, '\n');
  if (file.endsWith('.sql')) {
    const lines = code.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('--'));
    if (lines[0] !== '\\set ON_ERROR_STOP on' || !lines[1]?.startsWith(`DO $$ BEGIN RAISE EXCEPTION 'REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ${file}`)) {
      return 'retired SQL without the refusal header';
    }
    return null;
  }
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const refusal = stripped.indexOf(`refuseRetiredDestructiveScript('${file}')`);
  const firstUse = stripped.search(/new PrismaClient\(|\$executeRaw|\$queryRaw|\bspawn(?:Sync)?\(|\bexec(?:File)?Sync\(|\.query\(|\bmain\(\)|\bverify\(\)|\brunBenchmark\(\)/);
  if (refusal < 0 || (firstUse >= 0 && firstUse < refusal)) return 'retired but not refused before its first database or process call';
  return null;
}

/** Every problem of one file, given its scan. */
function evaluateFile(file: string, text: string, scan: FileScan, ctx: EvaluationContext): Problem[] {
  const problems: Problem[] = [];
  const add = (problem: string) => problems.push({ file, problem });
  if (GATE_FILES.has(file)) return problems;
  if (ctx.retired.has(file)) {
    const why = retiredRefusesFirst(file, text);
    if (why) add(why);
    return problems;
  }
  const historical = ctx.historical.get(file);
  if (historical) {
    if (normalisedSha(text) !== historical.sha256) add(`historical SQL changed (sha256 ${normalisedSha(text)}): a pinned migration is never edited; write a new governed one`);
    return problems;
  }
  const entry = ctx.reviewed.get(file);
  // U30F5 (D-7): the pinned open sites are reported apart (open: true), every other site as before
  const { open, rest } = splitOpen(file, scan.sites);
  for (const s of open) problems.push({ file, problem: `OPEN owner decision (U30F5 D-7): line ${s.line}: ${s.verdict} ${s.kind} via ${s.channel} (${s.detail}): ${s.excerpt}`, open: true });
  const keys = rest.map(siteKey);
  if (!entry) {
    for (const s of rest) {
      const where = /^prisma\/(migrations|spatial)\//.test(file) ? 'a migration that is not in the pinned historical list' : 'not gated, not ALLOWED, not reviewed';
      add(`line ${s.line}: ${s.verdict} ${s.kind} via ${s.channel} (${s.detail}) -- ${where}: ${s.excerpt}`);
    }
    return problems;
  }
  // exactly the reviewed multiset of sites
  const expected = [...entry.sites].sort();
  const actual = [...keys].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    const missing = expected.filter((k) => !actual.includes(k));
    const extra = actual.filter((k) => !expected.includes(k));
    add(`sites differ from the reviewed entry (${entry.policy}): new ${JSON.stringify(extra)} / gone ${JSON.stringify(missing)}`);
  }
  const text0 = text;
  for (const m of entry.markers ?? []) {
    // U30F3 (verifier L-1): a marker is a call of one of the policy's own gate doors, never an arbitrary pattern
    const doors = REVIEW_MARKER_DOORS[entry.policy] ?? [];
    if (!doors.some((d) => m === d || m.startsWith(`${d}\\(`))) add(`reviewed as ${entry.policy} but its marker /${m}/ is not a call of one of its gate doors (${doors.join(', ') || 'none'})`);
    if (!new RegExp(m).test(text0)) add(`reviewed as ${entry.policy} but its marker /${m}/ is gone`);
  }
  if (entry.callers) {
    const importers = ctx.importersOf(file).filter((f) => !entry.callers!.includes(f));
    if (importers.length) add(`reviewed as caller-guarded (${entry.policy}) but imported by ${importers.join(', ')}`);
  }
  const protectedSites = scan.sites.filter((s) => s.verdict === 'PROTECTED');
  if (entry.policy === 'DYNAMIC_REVIEWED' && protectedSites.length) add('a DYNAMIC_REVIEWED entry may not hold a PROTECTED site: gate it or retire the file');
  if (entry.policy === 'TEST_HARNESS') {
    if (!TEST_TREE.test(file)) add('reviewed as TEST_HARNESS but not in a test tree');
    const reach = testHarnessReach(file, ctx);
    if (reach) add(`reviewed as TEST_HARNESS but ${reach}`);
  }
  if (entry.policy === 'SANCTIONED_REBUILD') {
    const sanctioned = ctx.definition.relations.find((r) => r.relation === entry.relation);
    if (!sanctioned || sanctioned.sanctioned_rebuild !== file) add(`not the definition's sanctioned rebuilder of ${entry.relation}`);
    for (const s of protectedSites) {
      const others = s.detail.split(', ').filter((d) => !d.endsWith(` ${entry.relation}`));
      if (others.length) add(`a sanctioned rebuild of ${entry.relation} writes ${others.join(', ')}`);
    }
  }
  return problems;
}

interface RepositoryScan {
  readonly files: string[];
  readonly scans: Map<string, FileScan>;
  readonly texts: Map<string, string>;
}

/** U30F4 (B5): every symbolic link the repository walk skipped (reported, never silent). */
const REPO_LINKS: string[] = [];

function scanRepository(root: string, definition: ProtectedRelationsDefinition = PROTECTED_RELATIONS): RepositoryScan {
  const walkRules = { excludedDirNames: ['node_modules', '.git'], excludedPrefixes: [], isTestSource: () => false, links: REPO_LINKS };
  const files = walkRepository(root, walkRules).filter(
    (f) => !EXCLUDED.some((re) => re.test(f)),
  );
  const scans = new Map<string, FileScan>();
  const texts = new Map<string, string>();
  const read = readRepo(root);
  for (const f of files) {
    if (!isScannedPath(f)) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    texts.set(f, text);
    scans.set(f, scanFile(f, text, { definition, readRepoFile: read }));
  }
  return { files, scans, texts };
}

function contextFor(repo: RepositoryScan, overrides: { retired?: readonly string[]; definition?: ProtectedRelationsDefinition } = {}): EvaluationContext {
  const importers = (file: string): string[] => {
    const base = path.posix.basename(file).replace(/\.[cm]?[jt]sx?$/, '');
    const out: string[] = [];
    for (const [f, text] of repo.texts) {
      if (f === file) continue;
      if (new RegExp(`(from|import\\(|require\\()\\s*['"][^'"]*/${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[cm]?[jt]s)?['"]`).test(text)) out.push(f);
    }
    return out.sort();
  };
  const reachers = (file: string): string[] => {
    const target = file.replace(/\.[cm]?[jt]sx?$/, '');
    const base = path.posix.basename(file);
    const out: string[] = [];
    for (const [f, text] of repo.texts) {
      if (f === file) continue;
      let hit = text.includes(file) || (!/\.[cm]?[jt]sx?$/.test(file) && text.includes(base));
      if (!hit) {
        for (const m of text.matchAll(/(?:from|import\(|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
          const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]!)).replace(/\.[cm]?[jt]sx?$/, '');
          if (resolved === target) {
            hit = true;
            break;
          }
        }
      }
      if (hit) out.push(f);
    }
    return out.sort();
  };
  return {
    retired: new Set(overrides.retired ?? RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script)),
    reviewed: new Map(REVIEWED_CHANNELS.map((e) => [e.file, e])),
    historical: new Map(HISTORICAL_SQL.map((h) => [h.file, h])),
    definition: overrides.definition ?? PROTECTED_RELATIONS,
    importersOf: importers,
    reachersOf: reachers,
  };
}

const REPO = scanRepository(REPO_ROOT);
const CONTEXT = contextFor(REPO);

// ---------------------------------------------------------------------------------------------
// U30F5 (D-1): a file run by a scanned command or a runbook line is an executable entry, whatever its extension or name
// ---------------------------------------------------------------------------------------------

/** A launch's file in the repository: relative to the launcher's directory, else to the repository root. */
function resolveLaunch(by: string, file: string, exists: (f: string) => boolean): string[] {
  const candidates = [path.posix.normalize(path.posix.join(path.posix.dirname(by), file)), path.posix.normalize(file)];
  return [...new Set(candidates)].filter((c) => !c.startsWith('..') && exists(c));
}

/**
 * The command lines of a Markdown runbook's fenced blocks: a shell-tagged block (bash, sh, console, powershell, cmd ...)
 * is commands; an untagged block may be a listing, so only its interpreter lines count (`tsx x`, `bash x`), not a bare path.
 */
function runbookCommands(text: string): { line: string; tagged: boolean }[] {
  const out: { line: string; tagged: boolean }[] = [];
  let inBlock = false;
  let kind: 'shell' | 'untagged' | 'other' = 'other';
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const fence = /^\s*(```|~~~)\s*([A-Za-z0-9_+-]*)/.exec(raw);
    if (fence) {
      if (inBlock) inBlock = false;
      else {
        inBlock = true;
        const tag = fence[2] ?? '';
        kind = tag === '' ? 'untagged' : /^(bash|sh|shell|console|terminal|zsh|powershell|pwsh|ps1|ps|cmd|bat|batch)$/i.test(tag) ? 'shell' : 'other';
      }
      continue;
    }
    if (!inBlock || kind === 'other') continue;
    const line = raw.replace(/^\s*(\$|PS [^>]*>|>)\s+/, '');
    if (line.trim() && !line.trim().startsWith('#')) out.push({ line, tagged: kind === 'shell' });
  }
  return out;
}

/** The launches of runbook lines: every .md file of the repository (or the given texts). */
function runbookLaunchers(files: readonly string[], read: (p: string) => string | null): { by: string; launches: Launch[] }[] {
  const out: { by: string; launches: Launch[] }[] = [];
  for (const f of files) {
    if (!f.endsWith('.md') || EXCLUDED.some((re) => re.test(f))) continue;
    const text = read(f);
    if (text === null || !text.includes('```') && !text.includes('~~~')) continue;
    const launches: Launch[] = [];
    for (const { line: command, tagged } of runbookCommands(text)) {
      for (const pipeline of splitCommandLine(command)) {
        for (const seg of pipeline) {
          for (const l of commandRuns(seg.argv).launches) if (tagged || l.lang !== null) launches.push({ ...l, via: command.trim().slice(0, 160) });
        }
      }
    }
    if (launches.length) out.push({ by: f, launches });
  }
  return out;
}

interface LaunchedScan {
  readonly file: string;
  readonly text: string;
  readonly scan: FileScan;
  readonly by: string;
}

/**
 * U30F5 (D-1): every file a scanned command (npm script, CI step, Dockerfile, shell, process call) or a runbook line runs,
 * closed over what those run in turn. A test source run so is no test source (no runner, no TEST-DB-GUARD): it is
 * scanned. A data file or a script run by an interpreter of another language is scanned as what it runs as. A file of a
 * type the scan does not read, executed directly, and a path the scan excludes, fail.
 */
function evaluateLaunches(
  launchers: readonly { by: string; launches: readonly Launch[] }[],
  read: (p: string) => string | null,
  exists: (f: string) => boolean,
): { launched: LaunchedScan[]; problems: Problem[] } {
  const queue: { by: string; l: Launch }[] = launchers.flatMap((e) => e.launches.map((l) => ({ by: e.by, l })));
  const seen = new Set<string>();
  const launched: LaunchedScan[] = [];
  const problems: Problem[] = [];
  while (queue.length) {
    const { by, l } = queue.shift()!;
    for (const f of resolveLaunch(by, l.file, exists)) {
      const where = `run by ${by} (${l.via})`;
      if (EXCLUDED.some((re) => re.test(f))) {
        problems.push({ file: by, problem: `runs ${f}, a path the scan excludes -- ${where}` });
        continue;
      }
      const own = languageOf(f);
      const lang: Language | null = l.lang ?? own;
      if (lang === null) {
        problems.push({ file: f, problem: `executed directly, but its type (${fileTypeKey(f)}) is not read by the scan -- ${where}` });
        continue;
      }
      if (!TEST_SOURCE.test(f) && own === lang) continue; // a scanned file run as its own language
      const key = `${f}|${lang}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = read(f);
      if (text === null) continue;
      const scan = scanFile(f, text, { readRepoFile: read, language: lang });
      launched.push({ file: f, text, scan, by: where });
      for (const next of scan.launches) queue.push({ by: f, l: next });
    }
  }
  return { launched, problems };
}

/** The problems of the launched scans (each scanned as what it runs as) and of the launches themselves. */
function launchProblems(result: { launched: LaunchedScan[]; problems: Problem[] }, ctx: EvaluationContext): Problem[] {
  const out: Problem[] = [...result.problems];
  for (const l of result.launched) out.push(...evaluateFile(l.file, l.text, l.scan, ctx).map((p) => ({ ...p, problem: `${p.problem} -- ${l.by}` })));
  return out;
}

const REPO_FILES = new Set(REPO.files);
const REPO_LAUNCHES = evaluateLaunches(
  [...[...REPO.scans].map(([by, s]) => ({ by, launches: s.launches })), ...runbookLaunchers(REPO.files, readRepo(REPO_ROOT))],
  readRepo(REPO_ROOT),
  (f) => REPO_FILES.has(f),
);

/** The problems one (possibly new or changed) file would raise, scanned in memory against the real repository. */
function problemsOf(file: string, text: string, opts: { definition?: ProtectedRelationsDefinition; retired?: readonly string[] } = {}): Problem[] {
  const ctx = opts.definition || opts.retired ? contextFor(REPO, opts) : CONTEXT;
  const scan = scanFile(file, text, { definition: opts.definition, readRepoFile: readRepo(REPO_ROOT) });
  // U30F5: the pinned open sites (OPEN_OWNER_DECISIONS) are failed by their own BLOCKERARE test, not by every canary
  return evaluateFile(file, text, scan, ctx).filter((p) => !p.open);
}

function realText(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------------------------

describe('protected-write channel inventory: the repository (U30F2 H1, default deny)', () => {
  it('the scan sees the whole repository and its channels (it cannot pass vacuously)', () => {
    expect(REPO.scans.size).toBeGreaterThan(2000);
    const channels = [...REPO.scans.values()].reduce((n, s) => n + s.counts.channels, 0);
    const gated = [...REPO.scans.values()].reduce((n, s) => n + s.counts.gated, 0);
    expect(channels).toBeGreaterThan(500);
    expect(gated).toBeGreaterThan(30);
    for (const f of [
      'scripts/import/import-librarian-manifest.ts',
      'scripts/import/sguBulkImportEngine.ts',
      'scripts/data-pipeline/import_all_datasets.py',
      'scripts/import/sanitize-postgis-failed-imports.ps1',
      'scripts/db/import-nmd-outofdb.sh',
      'prisma/spatial/004_property_unit_core.sql',
      'package.json',
      '.github/workflows/ci.yml',
      'Dockerfile',
      'fly.toml',
    ]) {
      expect(REPO.scans.has(f), f).toBe(true);
    }
  });

  it('every channel of every file is gated, statically allowed, retired, a pinned migration or reviewed exactly', () => {
    const problems: Problem[] = [];
    for (const [file, scan] of REPO.scans) problems.push(...evaluateFile(file, REPO.texts.get(file)!, scan, CONTEXT));
    expect(problems.filter((p) => !p.open)).toEqual([]);
  });

  it('every file a scanned command or a runbook line runs is scanned as what it runs as (U30F5 D-1)', () => {
    expect(launchProblems(REPO_LAUNCHES, CONTEXT).filter((p) => !p.open)).toEqual([]);
    // the walk saw launches at all (it cannot pass vacuously): package.json scripts run tsx/node scripts
    expect([...REPO.scans.values()].reduce((n, s) => n + s.launches.length, 0)).toBeGreaterThan(20);
  });

  it('the pinned open owner decisions are not stale: each site is still in its file, each file still scanned (U30F5 D-7)', () => {
    expect(sha256Of(OPEN_OWNER_DECISIONS)).toBe(LOCKS.openDecisionsSha256);
    for (const [file, keys] of Object.entries(OPEN_OWNER_DECISIONS)) {
      expect(REPO.scans.has(file), file).toBe(true);
      expect(splitOpen(file, REPO.scans.get(file)!.sites).open.length, `${file}: an open site is gone -- remove it from OPEN_OWNER_DECISIONS`).toBe(keys.length);
    }
  });

  it('BLOCKERARE (U30F5 D-7): pre-existing CASCADE sites in operator scripts await an owner decision -- drop the CASCADE, gate it or retire the script', () => {
    const open: Problem[] = [];
    for (const [file, scan] of REPO.scans) open.push(...evaluateFile(file, REPO.texts.get(file)!, scan, CONTEXT).filter((p) => p.open));
    expect(open).toEqual([]);
  });

  it('no reviewed entry, historical file or gate file is stale', () => {
    for (const e of REVIEWED_CHANNELS) {
      expect(REPO.scans.has(e.file), `${e.file}: reviewed but not scanned`).toBe(true);
      expect(REPO.scans.get(e.file)!.sites.length, `${e.file}: reviewed but has no site any more (remove the entry)`).toBeGreaterThan(0);
    }
    for (const h of HISTORICAL_SQL) expect(REPO.scans.has(h.file), h.file).toBe(true);
    for (const g of GATE_IMPLEMENTATION) expect(fs.existsSync(path.join(REPO_ROOT, g.file)), g.file).toBe(true);
  });

  it('the reviewed list is pinned: count, sites and content hash; every entry justified', () => {
    expect(REVIEWED_CHANNELS.length).toBe(LOCKS.reviewedEntries);
    expect(REVIEWED_CHANNELS.reduce((n, e) => n + e.sites.length, 0)).toBe(LOCKS.reviewedSites);
    expect(sha256Of(REVIEWED_CHANNELS)).toBe(LOCKS.reviewedSha256);
    expect(new Set(REVIEWED_CHANNELS.map((e) => e.file)).size).toBe(REVIEWED_CHANNELS.length);
    for (const e of REVIEWED_CHANNELS) {
      expect(e.justification.trim().length, e.file).toBeGreaterThanOrEqual(60);
      expect(e.sites.length, e.file).toBeGreaterThan(0);
      if (e.policy === 'GOVERNED' || e.policy === 'TEST_DB_GUARD' || e.policy === 'GATED_VIA' || e.policy === 'SEPARATELY_GUARDED') {
        expect((e.markers?.length ?? 0) + (e.callers?.length ?? 0), `${e.file}: ${e.policy} needs a marker or a callers list`).toBeGreaterThan(0);
      }
      if (e.policy === 'SANCTIONED_REBUILD') expect(e.relation, e.file).toBeTruthy();
    }
  });

  it('the historical migrations, gate files, path exclusions, test-source rule and unscanned executables are pinned', () => {
    expect(HISTORICAL_SQL.length).toBe(LOCKS.historicalFiles);
    expect(sha256Of(HISTORICAL_SQL)).toBe(LOCKS.historicalSha256);
    expect(sha256Of(GATE_IMPLEMENTATION)).toBe(LOCKS.gateImplementationSha256);
    expect(sha256Of(PATH_EXCLUSIONS)).toBe(LOCKS.pathExclusionsSha256);
    expect(sha256Of({ UNSCANNED_EXECUTABLE_TYPES, UNSCANNED_EXECUTABLES })).toBe(LOCKS.unscannedSha256);
    expect(sha256Of(TEST_SOURCES)).toBe(LOCKS.testSourcesSha256);
    expect(sha256Of(REVIEW_MARKER_DOORS)).toBe(LOCKS.markerDoorsSha256);
    expect(sha256Of(FILE_TYPE_DECISIONS)).toBe(LOCKS.fileTypeDecisionsSha256);
    for (const x of [...HISTORICAL_SQL, ...PATH_EXCLUSIONS, ...UNSCANNED_EXECUTABLES, ...FILE_TYPE_DECISIONS]) expect(x.justification.length).toBeGreaterThanOrEqual(20);
    // U30F4 (B5): a type decided to be data is neither scanned nor an unscanned executable type, and each is decided once
    expect(new Set(FILE_TYPE_DECISIONS.map((d) => d.key)).size).toBe(FILE_TYPE_DECISIONS.length);
    for (const d of FILE_TYPE_DECISIONS) {
      expect(UNSCANNED_EXECUTABLE_TYPES.includes(d.key), d.key).toBe(false);
      expect(languageOf(`x/probe${d.key.startsWith('.') ? d.key : `/${d.key}`}`), d.key).toBeNull();
    }
  });

  it('every test-runner include glob (and exclusion) of TEST_SOURCES still stands in its runner configuration (U30F3 M-2)', () => {
    for (const r of [...TEST_SOURCES.runners, ...TEST_SOURCES.excluded]) {
      const config = fs.readFileSync(path.join(REPO_ROOT, r.config), 'utf8');
      expect(config.includes(r.literal), `${r.config}: ${r.literal}`).toBe(true);
    }
    expect(TEST_SOURCES.runners.length).toBeGreaterThanOrEqual(30);
  });

  it('every repository file of an executable type the scan does not read is listed (no new language slips past)', () => {
    const listed = new Set(UNSCANNED_EXECUTABLES.map((u) => u.file));
    const unscanned = REPO.files.filter((f) => {
      const base = f.split('/').pop()!;
      const ext = path.extname(base).toLowerCase();
      return (UNSCANNED_EXECUTABLE_TYPES.includes(ext) || UNSCANNED_EXECUTABLE_TYPES.includes(base)) && !TEST_SOURCE.test(f);
    });
    expect(unscanned.filter((f) => !listed.has(f))).toEqual([]);
    for (const u of UNSCANNED_EXECUTABLES) expect(fs.existsSync(path.join(REPO_ROOT, u.file)), u.file).toBe(true);
  });

  it('the retired list is pinned, justified, and every entry refuses first', () => {
    expect(RETIRED_DESTRUCTIVE_SCRIPTS.length).toBe(LOCKS.retiredCount);
    expect(sha256Of(RETIRED_DESTRUCTIVE_SCRIPTS)).toBe(LOCKS.retiredSha256);
    expect(new Set(RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script)).size).toBe(RETIRED_DESTRUCTIVE_SCRIPTS.length);
    for (const entry of RETIRED_DESTRUCTIVE_SCRIPTS) {
      expect(fs.existsSync(path.join(REPO_ROOT, entry.script)), entry.script).toBe(true);
      expect(entry.justification.trim().length, entry.script).toBeGreaterThanOrEqual(40);
      expect(retiredRefusesFirst(entry.script, realText(entry.script)), entry.script).toBeNull();
    }
    expect(() =>
      validateRetiredDestructiveScripts([
        { script: 'scripts/x.ts', protected_relations: ['env.sgu_well'], justification: 'too short', replacement: 'x', retired_by: 'x' },
      ]),
    ).toThrow(/needs a justification/);
  });

  it('no script refuses itself without being on the retired list', () => {
    const listed = new Set(RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script));
    for (const [file, text] of REPO.texts) {
      const m = text.match(/refuseRetiredDestructiveScript\('([^']+)'\)/);
      if (m && !GATE_FILES.has(file)) {
        expect(m[1], file).toBe(file);
        expect(listed.has(file), file).toBe(true);
      }
    }
  });

  it('the definition covers every SpatialLayerRegistry table and every ADMIT-V1 PostGIS target', () => {
    const relations = new Set(PROTECTED_RELATIONS.relations.map((r) => r.relation));
    for (const binding of Object.values(SPATIAL_LAYER_REGISTRY)) expect(relations.has(binding.table), binding.table).toBe(true);
    const contracts = fs.readFileSync(path.join(REPO_ROOT, 'docs/architecture/admit-v1/LAYER-ID-CONTRACTS-V1.md'), 'utf8');
    const admitted = contracts
      .split(/\r?\n/)
      .filter((l) => /^\| `lu\.[a-z_]+` \|/.test(l) && l.split('|').length >= 12)
      .flatMap((l) => [...l.split('|')[10]!.matchAll(/`([a-z_]+\.[a-z_0-9]+)`/g)].map((m) => m[1]!));
    expect(admitted.length).toBeGreaterThanOrEqual(11);
    for (const target of admitted) expect(relations.has(target), target).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The verifier's 31 canaries (v30f): every one is caught now
// ---------------------------------------------------------------------------------------------

const PRISMA = "import { PrismaClient } from '@prisma/client';\nconst p = new PrismaClient();\n";

const V30F_NEW_FILES: readonly (readonly [string, string, string])[] = [
  ['control: new ungated UPDATE of env.sgu_well', 'scripts/rogue/v30f-upd.ts', `${PRISMA}await p.$executeRawUnsafe('UPDATE env.sgu_well SET geom = NULL');\n`],
  ['control: new .mjs DELETE FROM env.sgu_well', 'scripts/rogue/v30f-del.mjs', "import pg from 'pg';\nawait new pg.Pool().query('DELETE FROM env.sgu_well');\n"],
  ['control: quoted lower-case "env"."sgu_well"', 'scripts/rogue/v30f-quoted.ts', `${PRISMA}await p.$executeRawUnsafe('truncate "env"."sgu_well"');\n`],
  ['new script in a directory named test/', 'scripts/test/v30f-wipe.ts', `${PRISMA}await p.$executeRawUnsafe('TRUNCATE env.sgu_well');\n`],
  ['new script under a dot-directory', 'scripts/.v30f/wipe.ts', `${PRISMA}await p.$executeRawUnsafe('TRUNCATE env.sgu_well');\n`],
  ['UPPER-CASE unquoted name (PostgreSQL folds it to env.sgu_well)', 'scripts/rogue/v30f-upper.ts', `${PRISMA}await p.$executeRawUnsafe('TRUNCATE ENV.SGU_WELL');\n`],
  [
    'target from SPATIAL_LAYER_REGISTRY via package alias',
    'scripts/rogue/v30f-registry.ts',
    "import { SPATIAL_LAYER_REGISTRY } from '@miljobeslut/spatial-provider-postgis';\n" + PRISMA + 'for (const b of Object.values(SPATIAL_LAYER_REGISTRY)) await p.$executeRawUnsafe(`TRUNCATE ${b.table}`);\n',
  ],
  ['target from the command line', 'scripts/rogue/v30f-argv.ts', PRISMA + 'await p.$executeRawUnsafe(`TRUNCATE ${process.argv[2]}`);\n'],
  ['name built by concatenation', 'scripts/rogue/v30f-concat.ts', `${PRISMA}await p.$executeRawUnsafe('TRUNCATE env.sgu_' + 'well');\n`],
  [
    'ogr2ogr -f PGDump then psql -f (two-step overwrite)',
    'scripts/rogue/v30f-pgdump.ts',
    "import { spawnSync } from 'child_process';\nspawnSync('ogr2ogr', ['-f', 'PGDump', 'out.sql', 'a.gpkg', '-nln', 'env.sgu_well']);\nspawnSync('psql', ['-f', 'out.sql']);\n",
  ],
  ['shp2pgsql -d piped to psql (.sh)', 'scripts/rogue/v30f-shp.sh', 'shp2pgsql -d -s 3006 a.shp env.sgu_well | psql "$DATABASE_URL"\n'],
  ['pg_restore --clean of env.sgu_well (.ps1)', 'scripts/rogue/v30f-restore.ps1', 'pg_restore --clean --if-exists -n env -t sgu_well dump.backup\n'],
  ['ALTER SCHEMA env RENAME (moves every LU layer away)', 'scripts/rogue/v30f-alter-schema.ts', `${PRISMA}const layer = 'sgu_well';\nawait p.$executeRawUnsafe('ALTER SCHEMA env RENAME TO env_old');\n`],
  ['DROP OWNED BY (drops everything the role owns)', 'scripts/rogue/v30f-owned.ts', `${PRISMA}const layer = 'sgu_well';\nawait p.$executeRawUnsafe('DROP OWNED BY miljobeslut CASCADE');\n`],
  ['a .cmd wrapper', 'scripts/rogue/v30f-wipe.cmd', 'psql -c "TRUNCATE env.sgu_well"\n'],
  [
    'control: ogr2ogr -sql DELETE against a PG source (ungated new file)',
    'scripts/rogue/v30f-ogrsql.ts',
    "import { spawnSync } from 'child_process';\nspawnSync('ogr2ogr', ['-f', 'GPKG', 'out.gpkg', 'PG:dbname=x', '-sql', 'DELETE FROM env.sgu_well']);\n",
  ],
];

const V30F_APPENDS: readonly (readonly [string, string, string])[] = [
  ['gated TS file: SQL passed via a variable to $executeRawUnsafe', 'scripts/import/bulk-import-sgu.ts', "const v30fSql = 'TRUNCATE env.sgu_well';\nawait prisma.$executeRawUnsafe(v30fSql);"],
  ['gated TS file: multi-line $executeRawUnsafe', 'scripts/import/bulk-import-sgu.ts', "await prisma.$executeRawUnsafe(\n  'TRUNCATE env.sgu_well',\n);"],
  ['gated TS file: $queryRawUnsafe with DELETE', 'scripts/import/bulk-import-sgu.ts', "await prisma.$queryRawUnsafe('DELETE FROM env.sgu_well');"],
  [
    'gated TS file: pg pool.query TRUNCATE',
    'scripts/import/sguBulkImportEngine.ts',
    "export async function v30f(pool: { query(s: string): Promise<unknown> }) { await pool.query('TRUNCATE env.sgu_well'); }",
  ],
  ['gated TS file: execSync psql -c TRUNCATE', 'scripts/import/bulk-import-sgu.ts', 'execSync(\'psql -c "TRUNCATE env.sgu_well"\');'],
  ['gated TS file: ogrinfo -sql DROP TABLE', 'scripts/import/bulk-import-sgu.ts', 'execSync(\'ogrinfo PG:dbname=x -sql "DROP TABLE env.sgu_well"\');'],
  [
    'gated TS file: ogr2ogr spawn via a differently named binary variable',
    'scripts/import/sguBulkImportEngine.ts',
    "export function v30fOgr(GDAL_BIN: string) { spawn(GDAL_BIN, ['-f', 'PostgreSQL', 'PG:x', 'a.gpkg', '-nln', 'env.sgu_well', '-overwrite']); }",
  ],
  ['control: gated TS file: same-line $executeRawUnsafe TRUNCATE without gatedSql', 'scripts/import/bulk-import-sgu.ts', "await prisma.$executeRawUnsafe('TRUNCATE env.sgu_well');"],
  ['gated Python file: module-level subprocess psql TRUNCATE', 'scripts/data-pipeline/import_all_datasets.py', "subprocess.run(['psql', '-c', 'TRUNCATE env.sgu_well'])"],
  [
    'gated Python file: def gates ANOTHER target then truncates a protected one',
    'scripts/data-pipeline/import_all_datasets.py',
    "def v30f_rogue():\n    assert_ungoverned_write_allowed(GATE_CALLER, 'TRUNCATE', 'public.v30f_tmp')\n    run_sql('TRUNCATE TABLE env.sgu_well')",
  ],
  ['control: gated Python file: new def truncating without any gate call', 'scripts/data-pipeline/import_all_datasets.py', "def v30f_rogue2():\n    run_sql('TRUNCATE TABLE env.sgu_well')"],
  ['gated PowerShell file: ogr2ogr -overwrite line', 'scripts/import/sanitize-postgis-failed-imports.ps1', '& ogr2ogr -f PostgreSQL "PG:dbname=x" a.gpkg -nln env.sgu_well -overwrite'],
  [
    'gated PowerShell file: gate call swallowed by try/catch, then DROP',
    'scripts/import/sanitize-postgis-failed-imports.ps1',
    "try { Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP' -Relation 'env.sgu_well' } catch { }\nInvoke-DbSql \"DROP TABLE IF EXISTS env.sgu_well CASCADE;\" 'x'",
  ],
  ['control: gated PowerShell file: DROP without a gate call', 'scripts/import/sanitize-postgis-failed-imports.ps1', "Invoke-DbSql \"DROP TABLE IF EXISTS env.sgu_well CASCADE;\" 'x'"],
];

describe("canaries: the verifier's 31 v30f cases are all caught", () => {
  it('31 cases: 16 new files, 14 additions to gated files, 1 retired-list change', () => {
    expect(V30F_NEW_FILES.length + V30F_APPENDS.length + 1).toBe(31);
  });

  it.each(V30F_NEW_FILES)('new file -- %s', (_label, file, content) => {
    expect(isScannedPath(file), `${file} is walked and scanned`).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(false);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it.each(V30F_APPENDS)('addition -- %s', (_label, file, append) => {
    const original = realText(file);
    expect(problemsOf(file, original)).toEqual([]); // clean before
    expect(problemsOf(file, `${original}\n${append}\n`).length).toBeGreaterThan(0);
  });

  it('retired list grown by one without the refusal in the file', () => {
    const file = 'scripts/import/bulk-import-sgu.ts';
    const retired = [...RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script), file];
    expect(problemsOf(file, realText(file), { retired }).map((p) => p.problem)).toEqual(['retired but not refused before its first database or process call']);
  });
});

// ---------------------------------------------------------------------------------------------
// More canaries: definitions, gates removed from real files, lists, migrations
// ---------------------------------------------------------------------------------------------

describe('canaries: changes to real files and lists are caught', () => {
  it('a relation newly added to the definition is protected by the scan at once', () => {
    const file = 'scripts/rogue/new-layer.ts';
    const content = "import { PrismaClient } from '@prisma/client';\nawait new PrismaClient().$executeRawUnsafe('TRUNCATE env.msb_new_layer');\n";
    expect(problemsOf(file, content)).toEqual([]);
    const extended = parseProtectedRelationsDefinition({
      contract: 'mimer-protected-relations-v1',
      retained_staging_schemas: [...PROTECTED_RELATIONS.retained_staging_schemas],
      relations: [
        ...PROTECTED_RELATIONS.relations.map((r) => ({ relation: r.relation, class: r.class, basis: r.basis, derived_from: r.derived_from, sanctioned_rebuild: r.sanctioned_rebuild })),
        { relation: 'env.msb_new_layer', class: 'LU_LIVE_LAYER', basis: 'canary: a newly admitted LU layer' },
      ],
    });
    expect(problemsOf(file, content, { definition: extended }).length).toBeGreaterThan(0);
  });

  it.each([
    ['a gatedSql removed (DROP of tables listed at run time)', 'scripts/import/sguBulkImportEngine.ts', '    await prisma.$executeRawUnsafe(gatedSql(GATE_CALLER, `DROP TABLE IF EXISTS ${table} CASCADE`));\n    dropped.push(table);', '    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${table} CASCADE`);\n    dropped.push(table);'],
    ['an ogr2ogr command gate removed', 'scripts/import/bulk-import-sgu-api-all.ts', 'execSync(assertOgr2ogrCommandAllowed({ caller: GATE_CALLER, command: ogrCmd }), ', 'execSync(ogrCmd, '],
    ['an ogr2ogr argv gate removed (U30F2 H1 wrap)', 'scripts/import/import-viss-water.ts', "assertOgr2ogrWriteAllowed({ caller: 'scripts/import/import-viss-water.ts', args: pgArgs })", 'pgArgs'],
    ['a PowerShell ogr2ogr gate removed (U30F2 H1 wrap)', 'scripts/import-topo.ps1', "$ogrArgs = Assert-Ogr2ogrWriteAllowed -Caller $gateCaller -Arguments @(", '$ogrArgs = @('],
    ['a Python relation gate removed', 'scripts/data-pipeline/import_lm_stac.py', "    assert_ungoverned_write_allowed(GATE_CALLER, 'OGR2OGR_WRITE', table)\n    mode =", '    mode ='],
    ['a Python command gate removed (U30F2 H1 wrap)', 'scripts/data-pipeline/import_topo10_all.py', 'subprocess.run(assert_command_write_allowed(GATE_CALLER, argv=cmd), check=True)', 'subprocess.run(cmd, check=True)'],
    ["a retired script's refusal removed", 'scripts/db/drop-staging-tables.ts', "refuseRetiredDestructiveScript('scripts/db/drop-staging-tables.ts');", ''],
    ["a retired SQL script's refusal header removed", 'scripts/db/partition-spatial-grid.sql', '\\set ON_ERROR_STOP on', ''],
    ['a historical migration edited', 'prisma/spatial/004_property_unit_core.sql', 'DROP TABLE', 'DROP TABLE IF EXISTS'],
    ['a reviewed dynamic file gains one more dynamic channel', 'scripts/devgov/devgov.mjs', 'const result = spawnSync(commandSpec.command,', 'spawnSync(process.env.EXTRA_TOOL, []);\n  const result = spawnSync(commandSpec.command,'],
    ['a governed marker removed', 'scripts/db/sync-property-unit-from-env.ts', "assertSanctionedDerivedRebuild({ caller: 'scripts/db/sync-property-unit-from-env.ts', relation: 'core.property_unit', operation: 'TRUNCATE' });", ''],
  ])('mutation: %s -> caught', (label, file, from, to) => {
    const original = realText(file);
    expect(original.split(from).length - 1, `${label}: anchor`).toBe(1);
    expect(problemsOf(file, original)).toEqual([]);
    expect(problemsOf(file, original.replace(from, () => to)).length, label).toBeGreaterThan(0);
  });

  it('a retired script dropped from the list leaves its protected writes unexplained', () => {
    const file = 'scripts/verify-jordarter.ts';
    const retired = RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script).filter((s) => s !== file);
    expect(problemsOf(file, realText(file), { retired }).length).toBeGreaterThan(0);
  });

  it('a NEW migration with a destructive statement against a protected relation fails; an allowed one passes', () => {
    expect(problemsOf('prisma/migrations/20261003000000_rogue/migration.sql', 'ALTER TABLE "User" ADD COLUMN x int;\nDROP TABLE env.protected_area;\n').length).toBeGreaterThan(0);
    expect(problemsOf('prisma/spatial/007_rogue.sql', 'TRUNCATE core.property_unit;\n').length).toBeGreaterThan(0);
    expect(problemsOf('prisma/migrations/20261003000001_ok/migration.sql', 'ALTER TABLE "User" ADD COLUMN y int;\nCREATE INDEX idx_y ON "User" (y);\n')).toEqual([]);
  });

  // U30F2 H1 mutation round: scanner rules that survived a mutation because no canary exercised them.
  it("a function parameter is the caller's value, never an outer loop element of the same name (scope shadowing)", () => {
    // an outer loop over static, unprotected names; a function whose parameter has the same name writes with it
    const js = (param: string) =>
      `import pg from 'pg';\nfor (const table of ['public.scratch_1']) console.log(table);\nexport async function wipe(${param}) {\n  await new pg.Pool().query(\`TRUNCATE \${table}\`);\n}\n`;
    expect(problemsOf('scripts/rogue/shadowed.mjs', js('table')).length).toBeGreaterThan(0);
    expect(problemsOf('scripts/rogue/shadowed.ts', js('table: string')).length).toBeGreaterThan(0);
    const py = "import psycopg2\ncur = psycopg2.connect('').cursor()\nfor table in ['public.scratch_1']:\n    print(table)\ndef wipe(table):\n    cur.execute(f'TRUNCATE {table}')\n";
    expect(problemsOf('scripts/rogue/shadowed.py', py).length).toBeGreaterThan(0);
    // control: the loop element itself, used inside the loop, is the static name
    const own = "import pg from 'pg';\nfor (const table of ['public.scratch_1']) await new pg.Pool().query(`TRUNCATE ${table}`);\n";
    expect(problemsOf('scripts/rogue/loop-own.mjs', own)).toEqual([]);
  });

  it('a relation gate covers only the value it checked: a statement with a second, unchecked target is caught', () => {
    // the SQL is handed to a function the scan does not know, so only the literal surface sees it
    const script = (sql: string) =>
      "import { assertUngovernedDestructiveWriteAllowed } from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';\n" +
      "import { handOff } from './hand-off';\nconst checked = process.argv[2]!;\nconst other = process.argv[3]!;\n" +
      "assertUngovernedDestructiveWriteAllowed({ caller: 'scripts/rogue/gated.ts', operation: 'DROP', relation: checked });\n" +
      `const sql = \`${sql}\`;\nawait handOff(sql);\n`;
    expect(problemsOf('scripts/rogue/gated.ts', script('DROP TABLE IF EXISTS ${checked}'))).toEqual([]);
    expect(problemsOf('scripts/rogue/gated.ts', script('DROP TABLE IF EXISTS ${checked}; DROP TABLE IF EXISTS ${other}')).length).toBeGreaterThan(0);
  });

  it('SQL piped on stdin is read: a pinned historical migration re-run through input: is caught; a harmless one is not', () => {
    const viaStdin = (sql: string) => `import { readFileSync } from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nspawnSync('psql', ['-v', 'ON_ERROR_STOP=1'], { input: ${sql} });\n`;
    expect(problemsOf('scripts/rogue/rerun-004.ts', viaStdin("readFileSync('prisma/spatial/004_property_unit_core.sql', 'utf8')")).length).toBeGreaterThan(0);
    expect(problemsOf('scripts/rogue/select-one.ts', viaStdin("'SELECT 1'"))).toEqual([]);
  });

  it('a Python loop over a literal list binds its element: static unprotected targets pass, a protected one is caught', () => {
    const loop = (tables: string) => `import psycopg2\ncur = psycopg2.connect('').cursor()\nfor t in [${tables}]:\n    cur.execute(f'TRUNCATE {t}')\n`;
    expect(problemsOf('scripts/rogue/loop-ok.py', loop("'public.scratch_1', 'public.scratch_2'"))).toEqual([]);
    expect(problemsOf('scripts/rogue/loop-bad.py', loop("'public.scratch_1', 'env.sgu_well'")).length).toBeGreaterThan(0);
  });

  it('a reviewed caller-guarded module imported by a new script fails', () => {
    const ctx = contextFor(REPO);
    const entry = REVIEWED_CHANNELS.find((e) => e.file === 'scripts/db/lib/applyRc6VersionedSpatialDdl.ts')!;
    const file = entry.file;
    const scan = REPO.scans.get(file)!;
    const withRogue: EvaluationContext = { ...ctx, importersOf: (f) => [...ctx.importersOf(f), 'scripts/rogue/uses-rc6.ts'] };
    expect(evaluateFile(file, REPO.texts.get(file)!, scan, ctx)).toEqual([]);
    expect(evaluateFile(file, REPO.texts.get(file)!, scan, withRogue).length).toBeGreaterThan(0);
  });
});

describe('canaries: a reviewed marker is a call of the policy\'s own gate door, never an arbitrary pattern (U30F3, U30F2 verifier L-1)', () => {
  // the verifier's canary2: a new GATED_VIA entry whose marker "pg" whitelisted an ungated TRUNCATE env.sgu_well
  const file = 'scripts/rogue/l1-marker.ts';
  const content = `${"import pg from 'pg';\nconst pool = new pg.Pool();\n"}await pool.query('TRUNCATE env.sgu_well');\n`;
  const withEntry = (markers: string[]): Problem[] => {
    const scan = scanFile(file, content, { readRepoFile: readRepo(REPO_ROOT) });
    const entry: ReviewedChannels = { file, policy: 'GATED_VIA', markers, justification: 'canary: an entry that names no gate door at all, only a word the file happens to contain', sites: scan.sites.map(siteKey) };
    return evaluateFile(file, content, scan, { ...CONTEXT, reviewed: new Map([...CONTEXT.reviewed, [file, entry]]) });
  };

  it('a GATED_VIA entry whose marker is not a gate call ("pg", a bare word) is a problem even though the file matches it', () => {
    expect(scanFile(file, content, { readRepoFile: readRepo(REPO_ROOT) }).sites.some((s) => s.verdict === 'PROTECTED')).toBe(true);
    for (const markers of [['pg'], ['TRUNCATE'], ['pool\\.query\\(']]) expect(withEntry(markers).length, JSON.stringify(markers)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F3 H-1 (U30F2-VERIFICATION H-1): the fold cap fails closed
// ---------------------------------------------------------------------------------------------

/** The scanner's fold cap: FOLD_MAX_TEXTS (before U30F3 an unexported 16). */
const FOLD_CAP: number = (channels as { FOLD_MAX_TEXTS?: number }).FOLD_MAX_TEXTS ?? 16;
const PG_POOL = "import pg from 'pg';\nconst pool = new pg.Pool();\n";
const scratchTables = (n: number) => Array.from({ length: n }, (_, i) => `'public.scratch_${i}'`).join(', ');

describe('canaries: the fold cap fails closed (U30F3 H-1)', () => {
  it('a loop over FOLD_CAP + 1 static tables with the protected one LAST is caught (JS pool.query, Python cursor)', () => {
    const js = `${PG_POOL}const tables = [${scratchTables(FOLD_CAP)}, 'env.sgu_well'];\nfor (const t of tables) await pool.query(\`TRUNCATE \${t}\`);\n`;
    expect(problemsOf('scripts/rogue/cap-last.ts', js).length).toBeGreaterThan(0);
    const py = `import psycopg2\ncur = psycopg2.connect('').cursor()\nfor t in [${scratchTables(FOLD_CAP)}, 'env.sgu_well']:\n    cur.execute(f'TRUNCATE {t}')\n`;
    expect(problemsOf('scripts/rogue/cap-last.py', py).length).toBeGreaterThan(0);
  });

  it('a ternary chain of FOLD_CAP + 1 branches with the protected value last is caught', () => {
    const chain = Array.from({ length: FOLD_CAP }, (_, i) => `n === ${i} ? 'public.scratch_${i}' : `).join('');
    const js = `${PG_POOL}const n = Number(process.argv[2]);\nconst t = ${chain}'env.sgu_well';\nawait pool.query('TRUNCATE ' + t);\n`;
    expect(problemsOf('scripts/rogue/cap-ternary.ts', js).length).toBeGreaterThan(0);
  });

  it('values past the cap are reported UNRESOLVABLE (FOLD_CAP_EXCEEDED) even when every enumerated value is unprotected -- never dropped', () => {
    const js = `${PG_POOL}const tables = [${scratchTables(FOLD_CAP + 1)}];\nfor (const t of tables) await pool.query(\`TRUNCATE \${t}\`);\n`;
    const scan = scanFile('scripts/rogue/cap-unprotected.ts', js, { readRepoFile: readRepo(REPO_ROOT) });
    const call = scan.sites.find((s) => s.kind === 'SQL_CALL');
    expect(call?.verdict).toBe('UNRESOLVABLE');
    expect(call?.detail).toContain('FOLD_CAP_EXCEEDED');
    expect(problemsOf('scripts/rogue/cap-unprotected.ts', js).length).toBeGreaterThan(0);
  });

  it('an enumerated protected value is never masked by the cap: the protected table FIRST of FOLD_CAP + 1 keeps the channel PROTECTED', () => {
    const js = `${PG_POOL}const tables = ['env.sgu_well', ${scratchTables(FOLD_CAP)}];\nfor (const t of tables) await pool.query(\`TRUNCATE \${t}\`);\n`;
    const call = scanFile('scripts/rogue/cap-first.ts', js, { readRepoFile: readRepo(REPO_ROOT) }).sites.find((s) => s.kind === 'SQL_CALL');
    expect(call?.verdict).toBe('PROTECTED');
    expect(call?.detail).toContain('TRUNCATE env.sgu_well');
  });

  it('control: exactly FOLD_CAP static unprotected tables fit the cap and pass', () => {
    const js = `${PG_POOL}const tables = [${scratchTables(FOLD_CAP)}];\nfor (const t of tables) await pool.query(\`TRUNCATE \${t}\`);\n`;
    expect(problemsOf('scripts/rogue/cap-fits.ts', js)).toEqual([]);
  });

  it('the write the cap hid in the repository: import-sgu-risk-layers.ts CREATE TABLE IF NOT EXISTS over envTables holding env.sgu_well / env.sgu_landslide_feature, ungated, is PROTECTED', () => {
    const file = 'scripts/import/import-sgu-risk-layers.ts';
    let text = realText(file);
    // the shape before U30F3: both protected entries in envTables and the CREATE without a gate
    for (const name of ['env.sgu_landslide_feature', 'env.sgu_well']) {
      if (!text.includes(`name: '${name}'`)) text = text.replace('const envTables = [', `const envTables = [\n    { name: '${name}', cols: 'id SERIAL PRIMARY KEY, geom GEOMETRY' },`);
    }
    text = text.replace(
      /await prisma\.\$executeRawUnsafe\((?:gatedSql\(GATE_CALLER, )?(`CREATE TABLE IF NOT EXISTS \$\{table\.name\} \(\$\{table\.cols\}\);`)\)?\);/,
      (_m, sql: string) => `await prisma.$executeRawUnsafe(${sql});`,
    );
    expect(text).toContain('await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${table.name} (${table.cols});`);');
    const create = scanFile(file, text, { readRepoFile: readRepo(REPO_ROOT) }).sites.find((s) => s.kind === 'SQL_CALL' && s.excerpt.includes('CREATE TABLE IF NOT EXISTS ${table.name}'));
    expect(create?.verdict).toBe('PROTECTED');
    expect(create?.detail).toContain('CREATE env.sgu_landslide_feature');
    expect(create?.detail).toContain('CREATE env.sgu_well');
    expect(problemsOf(file, text).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F3 M-2 (U30F2-VERIFICATION M-2): destructive CLI entry points and test-named scripts
// ---------------------------------------------------------------------------------------------

describe('canaries: destructive CLI entry points and attacker-chosen test names (U30F3 M-2)', () => {
  it.each([
    ['V53: a .cmd running dropdb of the whole database', 'scripts/rogue/u30f3-dropdb.cmd', '@echo off\r\ndropdb -h localhost -U postgres miljobeslut\r\n'],
    ['dropdb through execSync (TS)', 'scripts/rogue/u30f3-dropdb.ts', "import { execSync } from 'node:child_process';\nexecSync('dropdb --if-exists miljobeslut');\n"],
    ['V54: pgloader --with truncate into env.sgu_well (sh)', 'scripts/rogue/u30f3-pgloader.sh', '#!/bin/sh\npgloader --with truncate a.csv "postgresql:///db?tablename=env.sgu_well"\n'],
    ['pgloader with a load file (PowerShell)', 'scripts/rogue/u30f3-pgloader.ps1', '& pgloader wipe.load\n'],
    ['osm2pgsql --drop (Python subprocess)', 'scripts/rogue/u30f3-osm.py', "import subprocess\nsubprocess.run(['osm2pgsql', '--drop', '-d', 'gis', 'planet.osm.pbf'], check=True)\n"],
    ['qgis_process running SQL against PostGIS (sh)', 'scripts/rogue/u30f3-qgis.sh', '#!/bin/sh\nqgis_process run native:postgisexecutesql --DATABASE=lm --SQL="TRUNCATE x"\n'],
    ['ogrmerge.py into PostgreSQL (sh)', 'scripts/rogue/u30f3-ogrmerge.sh', '#!/bin/sh\nogrmerge.py -f PostgreSQL -o PG:dbname=x a.shp -nln sgu_well -overwrite_ds\n'],
  ])('%s -> caught', (_label, file, content) => {
    expect(isScannedPath(file), file).toBe(true);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it('control: ogrmerge.py into a GeoPackage file and createdb pass', () => {
    expect(problemsOf('scripts/rogue/u30f3-ogrmerge-ok.sh', '#!/bin/sh\nogrmerge.py -f GPKG -o out.gpkg a.shp b.shp\ncreatedb scratch_db\n')).toEqual([]);
  });

  it.each([
    ['V72: an operator script named *.spec.ts (run with tsx, outside every test runner)', 'scripts/db/purge-layer.spec.ts'],
    ['V73: an operator script under a directory named __tests__/', 'scripts/__tests__/purge.ts'],
    ['a *.spec.mjs next to server code', 'server/services/purge.spec.mjs'],
  ])('%s is scanned and caught', (_label, file) => {
    expect(isScannedPath(file), `${file} must be scanned: the scanner never exempts a file by a name an author can choose`).toBe(true);
    expect(problemsOf(file, `${PG_POOL}await pool.query('TRUNCATE env.sgu_well');\n`).length).toBeGreaterThan(0);
  });

  it('owner decision (U30F3 M-2, sharpened): a file is a test source only when a configured test runner runs it -- an operator script named *.test.ts outside every runner glob, or placed in a test tree without a test name (V74), is scanned and caught', () => {
    for (const file of ['tests/ops/purge.ts', 'packages/spatial-provider-postgis/tests/helper-purge.ts', 'scripts/db/purge.test.ts', 'server/services/purge.test.ts']) {
      expect(isScannedPath(file), file).toBe(true);
      expect(problemsOf(file, `${PG_POOL}await pool.query('TRUNCATE env.sgu_well');\n`).length, file).toBeGreaterThan(0);
    }
  });

  it('a TEST_HARNESS helper (test-tree only) reached from a script outside the test trees is a problem', () => {
    const file = 'tests/helpers/postgisSeed.ts';
    const scan = REPO.scans.get(file)!;
    expect(REVIEWED_CHANNELS.find((e) => e.file === file)?.policy).toBe('TEST_HARNESS');
    expect(evaluateFile(file, REPO.texts.get(file)!, scan, CONTEXT)).toEqual([]);
    const rogue: EvaluationContext = { ...CONTEXT, reachersOf: (f) => (f === file ? ['scripts/rogue/seed-live.ts', ...CONTEXT.reachersOf(f)] : CONTEXT.reachersOf(f)) };
    expect(evaluateFile(file, REPO.texts.get(file)!, scan, rogue).map((p) => p.problem).join('\n')).toContain('reached from scripts/rogue/seed-live.ts');
  });

  it('control: files a configured runner runs stay test sources', () => {
    for (const file of ['tests/unit/protectedRelationGateInventory.test.ts', 'packages/spatial-provider-postgis/tests/ProtectedRelationGate.test.ts', 'tests/e2e/admin-flow.spec.ts', 'scripts/audit/master-boundary-audit.test.ts', 'packages/alpha-runtime/src/__tests__/pfas_scenario.test.ts']) {
      expect(isScannedPath(file), file).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// U30F3 M-2 (owner decision 2026-10-02, sharpened): unknown or dynamic write channels fail closed. The
// verifier's 26 missed forms (U30F2-VERIFICATION M-2) that the first M-2 round left open, and the same classes
// in more spellings: a channel is recognised by the MODULE it comes from, not by a receiver's name.
// ---------------------------------------------------------------------------------------------

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const KNEX = "import knexFactory from 'knex';\nconst k = knexFactory({ client: 'pg' });\n";

describe('canaries: unknown or dynamic write channels fail closed (U30F3 M-2, owner decision)', () => {
  it.each([
    ['V27 knex instance named k, raw() with base64 SQL', 'scripts/vrogue/v27.ts', `${KNEX}await k.raw(Buffer.from('${b64('TRUNCATE env.sgu_well')}', 'base64').toString());\n`],
    ['V28 knex raw() with a static SQL that starts with ;', 'scripts/vrogue/v28.ts', `${KNEX}await k.raw(';TRUNCATE env.sgu_well');\n`],
    ['V29 knex query builder: DELETE without WHERE via .del()', 'scripts/vrogue/v29.ts', `${KNEX}await k('env.sgu_well').del();\n`],
    ['V30 knex schema builder: dropTableIfExists', 'scripts/vrogue/v30.ts', `${KNEX}await k.schema.withSchema('env').dropTableIfExists('sgu_well');\n`],
    ['V31 pg-promise transaction t.none(dynamic SQL)', 'scripts/vrogue/v31.ts', "import pgp from 'pg-promise';\nconst db = pgp()(process.env.X!);\nawait db.tx(async (t) => { await t.none(process.argv[2]!); });\n"],
    ['V32 postgres.js instance named s, unsafe(dynamic)', 'scripts/vrogue/v32.ts', "import postgres from 'postgres';\nconst s = postgres(process.env.X!);\nawait s.unsafe(process.argv[2]!);\n"],
    ['V33 shelljs exec(dynamic command)', 'scripts/vrogue/v33.ts', "import shell from 'shelljs';\nshell.exec(Buffer.from(process.argv[2]!, 'base64').toString());\n"],
    ['V34 child_process renamed import: execSync as run, dynamic', 'scripts/vrogue/v34.ts', "import { execSync as run } from 'node:child_process';\nrun(`psql -c \"${process.argv[2]}\"`);\n"],
    ['V35 child_process via a namespace import, dynamic', 'scripts/vrogue/v35.ts', "import * as nodeCp from 'node:child_process';\nnodeCp.spawnSync('psql', ['-c', process.argv[2]!]);\n"],
    ['V36 child_process bracket access, dynamic', 'scripts/vrogue/v36.ts', "import * as child_process from 'node:child_process';\nchild_process['execSync'](process.argv[2]!);\n"],
    ['V37 eval of decoded code', 'scripts/vrogue/v37.ts', `eval(Buffer.from('${b64("require('child_process').execSync('psql -c \"TRUNCATE env.sgu_well\"')")}', 'base64').toString());\n`],
    ['V39 Python conn.cursor().execute(dynamic)', 'scripts/vrogue/v39.py', "import sys, psycopg2\nconn = psycopg2.connect('')\nconn.cursor().execute(sys.argv[1])\n"],
    ['V40 Python import subprocess as sp; sp.run(psql, dynamic)', 'scripts/vrogue/v40.py', "import sys\nimport subprocess as sp\nsp.run(['psql', '-c', sys.argv[1]], check=True)\n"],
    ['V41 Python from subprocess import run as r; r(...) dynamic', 'scripts/vrogue/v41.py', "import sys\nfrom subprocess import run as r\nr(['psql', '-c', sys.argv[1]], check=True)\n"],
    ['V42 Python SQLAlchemy exec_driver_sql(dynamic)', 'scripts/vrogue/v42.py', "import sys\nfrom sqlalchemy import create_engine\nwith create_engine('postgresql://').begin() as conn:\n    conn.exec_driver_sql(sys.argv[1])\n"],
    ['V43 Python asyncpg copy_records_to_table into env.sgu_well (static)', 'scripts/vrogue/v43.py', "import asyncpg\nasync def main(rows):\n    conn = await asyncpg.connect('')\n    await conn.copy_records_to_table('sgu_well', schema_name='env', records=rows)\n"],
    ['V46 Python with-cursor named c, c.copy (psycopg3) dynamic', 'scripts/vrogue/v46.py', "import sys, psycopg\nwith psycopg.connect('') as conn:\n    with conn.cursor() as c:\n        with c.copy(sys.argv[1]) as cp:\n            cp.write(b'')\n"],
    ['V64 sh: docker compose down -v (removes the postgres volume)', 'scripts/vrogue/v64.sh', '#!/bin/sh\ndocker compose -f docker-compose.yml down -v\n'],
    ['V74 a script under tests/ops/ (no test name, no runner runs it)', 'tests/ops/purge.ts', `${PG_POOL}await pool.query('TRUNCATE env.sgu_well');\n`],
    ['JS: pg-cursor over dynamic SQL', 'scripts/vrogue/g1.ts', "import Cursor from 'pg-cursor';\nimport pg from 'pg';\nconst c = new pg.Client();\nc.query(new Cursor(process.argv[2]!));\n"],
    ['JS: require of a computed module name', 'scripts/vrogue/g2.cjs', "const m = require(process.env.MOD);\nm.run(process.argv[2]);\n"],
    ['JS: dynamic import() of a computed module name', 'scripts/vrogue/g3.mjs', "const m = await import(process.env.MOD);\nawait m.default(process.argv[2]);\n"],
    ['JS: a raw SQL function used as a value', 'scripts/vrogue/g4.ts', `${PRISMA}const run = p.$executeRawUnsafe.bind(p);\nawait run(process.argv[2]!);\n`],
    ['JS: default import of child_process, method through the binding (dynamic)', 'scripts/vrogue/g5.ts', "import cp from 'child_process';\ncp.execSync(process.argv[2]!);\n"],
    ['JS: require of child_process bound to a name, dynamic', 'scripts/vrogue/g6.cjs', "const proc = require('child_process');\nproc.spawnSync(process.argv[2], []);\n"],
    ['JS: destructured require with a rename, dynamic', 'scripts/vrogue/g7.cjs', "const { execSync: sh } = require('node:child_process');\nsh(process.argv[2]);\n"],
    ['JS: new Function over decoded code', 'scripts/vrogue/g8.ts', `new Function(Buffer.from('${b64('return 1')}', 'base64').toString())();\n`],
    ['Python: psycopg2.extras.execute_values(cur, dynamic)', 'scripts/vrogue/g9.py', "import sys, psycopg2\nfrom psycopg2.extras import execute_values\ncur = psycopg2.connect('').cursor()\nexecute_values(cur, sys.argv[1], [])\n"],
    ['Python: pexpect spawning a dynamic command', 'scripts/vrogue/g10.py', "import sys, pexpect\npexpect.run(sys.argv[1])\n"],
    ['Python: asyncio.create_subprocess_shell(dynamic)', 'scripts/vrogue/g11.py', "import sys, asyncio\nasync def main():\n    await asyncio.create_subprocess_shell(sys.argv[1])\n"],
    ['Python: __import__ of subprocess', 'scripts/vrogue/g12.py', "import sys\n__import__('subprocess').run(sys.argv[1], shell=True)\n"],
    ['Python: getattr on the subprocess module', 'scripts/vrogue/g13.py', "import sys, subprocess\ngetattr(subprocess, 'run')(sys.argv[1], shell=True)\n"],
    ['Python: exec of dynamic code', 'scripts/vrogue/g14.py', "import sys\nexec(sys.argv[1])\n"],
    ['PowerShell: a scriptblock created from a dynamic string', 'scripts/vrogue/g15.ps1', 'param([string]$c)\n& ([scriptblock]::Create($c))\n'],
  ])('%s -> caught', (_label, file, content) => {
    expect(isScannedPath(file), file).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(false);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it('a static statement after a leading ; is SQL on the literal surface too (V28 handed to a function the scan does not know)', () => {
    // U30F3 mutation round 2: the leading-; rule survived because V28's knex import is caught on its own
    expect(problemsOf('scripts/vrogue/g16.ts', "import { handOff } from './hand-off';\nawait handOff(';TRUNCATE env.sgu_well');\n").length).toBeGreaterThan(0);
  });

  it.each([
    ['JS: named child_process import used statically', 'scripts/vrogue/c1.ts', "import { spawnSync } from 'node:child_process';\nspawnSync('git', ['status']);\n"],
    ['JS: a namespace import of child_process used statically', 'scripts/vrogue/c2.ts', "import * as cp from 'node:child_process';\ncp.spawnSync('git', ['status']);\n"],
    ['Python: import subprocess as sp used statically', 'scripts/vrogue/c3.py', "import subprocess as sp\nsp.run(['git', 'status'], check=True)\n"],
    ['Python: shutil.copy and dict.copy are file / object copies', 'scripts/vrogue/c4.py', "import shutil\nshutil.copy('a.txt', 'b.txt')\nd = {}.copy()\n"],
    ['sh: docker compose down WITHOUT -v keeps the volume', 'scripts/vrogue/c5.sh', '#!/bin/sh\ndocker compose -f docker-compose.yml down\n'],
  ])('control: %s passes', (_label, file, content) => {
    expect(problemsOf(file, content)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F4 (owner: close the cheap parts of B1, B2 and B5 now; the rest stays BLOCKERARE until DB-level protection)
// ---------------------------------------------------------------------------------------------

/** The decision key of a file type: its extension, or its whole name when it has none (Dockerfile, .gitignore). */
function fileTypeKey(rel: string): string {
  const base = rel.split('/').pop()!;
  const ext = path.extname(base).toLowerCase();
  return ext === '' ? base : ext;
}

/** File types without a decision: not scanned, not an unscanned executable type (listed per file), not decided data. */
function fileTypeProblems(files: readonly string[]): string[] {
  const decisions = FILE_TYPE_DECISIONS.map((d) => d.key);
  const listed = new Set(UNSCANNED_EXECUTABLES.map((u) => u.file));
  const out: string[] = [];
  for (const f of files) {
    if (EXCLUDED.some((re) => re.test(f)) || languageOf(f) !== null) continue;
    const key = fileTypeKey(f);
    if (UNSCANNED_EXECUTABLE_TYPES.includes(key) || UNSCANNED_EXECUTABLE_TYPES.includes(path.extname(f).toLowerCase())) {
      if (!listed.has(f) && !TEST_SOURCE.test(f)) out.push(`${f}: an unscanned executable type that is not listed`);
    } else if (!decisions.includes(key)) out.push(`${f}: file type ${key} has no decision (scan it, list it as an unscanned executable type, or decide it is data)`);
  }
  return out;
}

/** Symbolic links the walk skipped that are not node_modules (a link would hide what it points at from the scan). */
function unexpectedLinks(links: readonly string[]): string[] {
  return links.filter((l) => !/(^|\/)node_modules$/.test(l));
}

const PY_ASYNCPG = "import sys, asyncpg\nasync def main():\n    conn = await asyncpg.connect('')\n";
const PY_SQLA = "import sys\nfrom sqlalchemy import MetaData, Table, create_engine, text\nengine = create_engine('postgresql://')\nmd = MetaData()\n";

describe('canaries: U30F4 -- B2 SQL-executing methods of read clients, B1 reflection forms, B5 file types and links', () => {
  it.each([
    ['B2 asyncpg fetch(dynamic)', 'scripts/vrogue/b2a.py', `${PY_ASYNCPG}    await conn.fetch(sys.argv[1])\n`],
    ['B2 asyncpg fetchrow(dynamic)', 'scripts/vrogue/b2b.py', `${PY_ASYNCPG}    await conn.fetchrow(sys.argv[1])\n`],
    ['B2 asyncpg fetchval(dynamic)', 'scripts/vrogue/b2c.py', `${PY_ASYNCPG}    await conn.fetchval(sys.argv[1])\n`],
    ['B2 asyncpg prepare(dynamic)', 'scripts/vrogue/b2d.py', `${PY_ASYNCPG}    stmt = await conn.prepare(sys.argv[1])\n    await stmt.fetch()\n`],
    ['B2 asyncpg cursor(dynamic)', 'scripts/vrogue/b2e.py', `${PY_ASYNCPG}    async for r in conn.cursor(sys.argv[1]):\n        print(r)\n`],
    ['B2 asyncpg copy_from_query(dynamic)', 'scripts/vrogue/b2f.py', `${PY_ASYNCPG}    await conn.copy_from_query(sys.argv[1], output='o.csv')\n`],
    ['B2 pandas pd.read_sql(dynamic)', 'scripts/vrogue/b2g.py', "import sys\nimport pandas as pd\npd.read_sql(sys.argv[1], 'postgresql://')\n"],
    ['B2 pandas read_sql_query imported by name (dynamic)', 'scripts/vrogue/b2h.py', "import sys\nfrom pandas import read_sql_query\nread_sql_query(sys.argv[1], 'postgresql://')\n"],
    ['B2 SQLAlchemy metadata.drop_all', 'scripts/vrogue/b2i.py', `${PY_SQLA}md.reflect(bind=engine, schema='env')\nmd.drop_all(engine)\n`],
    ['B2 SQLAlchemy Table.drop', 'scripts/vrogue/b2j.py', `${PY_SQLA}Table('sgu_well', md, schema='env').drop(engine)\n`],
    ['B2 SQLAlchemy ORM query(...).delete()', 'scripts/vrogue/b2k.py', `${PY_SQLA}from sqlalchemy.orm import Session\nwith Session(engine) as s:\n    s.query(Well).delete()\n`],
    ['B2 SQLAlchemy conn.scalar(text(dynamic))', 'scripts/vrogue/b2l.py', `${PY_SQLA}with engine.begin() as conn:\n    conn.scalar(text(sys.argv[1]))\n`],
    ['B2 psycopg2 callproc (the procedure body is not in the source)', 'scripts/vrogue/b2m.py', "import psycopg2\ncur = psycopg2.connect('').cursor()\ncur.callproc('wipe_layers')\n"],
    ['B2 psycopg (3) cursor.stream(dynamic)', 'scripts/vrogue/b2n.py', "import sys, psycopg\nwith psycopg.connect('') as conn:\n    cur = conn.cursor()\n    for r in cur.stream(sys.argv[1]):\n        print(r)\n"],
    ['B1 vm named import runInNewContext(dynamic)', 'scripts/vrogue/b1a.ts', "import { runInNewContext } from 'node:vm';\nrunInNewContext(process.argv[2]!);\n"],
    ['B1 vm default import, new Script(dynamic)', 'scripts/vrogue/b1b.ts', "import vm2 from 'vm';\nnew vm2.Script(process.argv[2]!).runInThisContext();\n"],
    ['B1 vm destructured require, new Script(dynamic)', 'scripts/vrogue/b1c.cjs', "const { Script } = require('node:vm');\nnew Script(process.argv[2]).runInThisContext();\n"],
    ['B1 new Worker(code, { eval: true })', 'scripts/vrogue/b1d.ts', "import { Worker } from 'node:worker_threads';\nnew Worker(process.argv[2]!, { eval: true });\n"],
    ['B1 indirect eval (0, eval)(x)', 'scripts/vrogue/b1e.ts', '(0, eval)(process.argv[2]!);\n'],
    ['B1 Reflect.apply(eval, ...)', 'scripts/vrogue/b1f.ts', 'Reflect.apply(eval, undefined, [process.argv[2]]);\n'],
    ["B1 globalThis['ev' + 'al'](x)", 'scripts/vrogue/b1g.ts', "globalThis['ev' + 'al'](process.argv[2]);\n"],
    // U30F4 mutation round: each rule on its own (b1f is caught twice -- eval as a value and Reflect.apply)
    ['B1 eval of a literal (the code in the string is not read)', 'scripts/vrogue/b1h.ts', "eval(\"require('node:child_process').execSync(process.env.W_CMD)\");\n"],
    ['B1 Reflect.construct(Function, [x])', 'scripts/vrogue/b1i.ts', 'Reflect.construct(Function, [process.argv[2]!])();\n'],
    ['B1 new Worker(x, options the source does not hold)', 'scripts/vrogue/b1j.ts', "import { Worker } from 'node:worker_threads';\nconst opts = JSON.parse(process.env.W_OPTS!);\nnew Worker(process.argv[2]!, opts);\n"],
  ])('%s -> caught', (_label, file, content) => {
    expect(isScannedPath(file), file).toBe(true);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it.each([
    ['pandas DataFrame.drop in a file without SQLAlchemy', 'scripts/vrogue/c6.py', "import pandas as pd\ndf = pd.DataFrame()\ndf = df.drop(columns=['a'])\n"],
    ['asyncpg fetch of a static SELECT', 'scripts/vrogue/c7.py', `${PY_ASYNCPG}    await conn.fetch('SELECT 1')\n`],
    ['a worker running a file, not code', 'scripts/vrogue/c8.ts', "import { Worker } from 'node:worker_threads';\nnew Worker(new URL('./w.mjs', import.meta.url));\n"],
    ['an object key named eval', 'scripts/vrogue/c9.ts', 'export const opts = { eval: false };\n'],
    ['a worker running a file with eval: false', 'scripts/vrogue/c10.ts', "import { Worker } from 'node:worker_threads';\nnew Worker(new URL('./w.mjs', import.meta.url), { eval: false });\n"],
  ])('control: %s passes', (_label, file, content) => {
    expect(problemsOf(file, content)).toEqual([]);
  });

  // U30F4 (B2, "other SQL-executing methods of listed clients"): forms of node-postgres, ADO.NET/Npgsql and SQLAlchemy
  it.each([
    ['B2 node-postgres QueryConfig with a shorthand text', 'scripts/vrogue/b2o.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst text = process.argv[2]!;\nawait pool.query({ text, values: [] });\n"],
    ['B2 node-postgres QueryConfig spread from run time', 'scripts/vrogue/b2p.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst cfg = JSON.parse(process.env.W_Q!);\nawait pool.query({ ...cfg });\n"],
    ['B2 ADO.NET executenonquery() in lower case (PowerShell is case-insensitive)', 'scripts/vrogue/b2q.ps1', "$cmd = $conn.CreateCommand()\n$cmd.CommandText = $args[0]\n$cmd.executenonquery()\n"],
    ['B2 ADO.NET ExecuteNonQueryAsync()', 'scripts/vrogue/b2r.ps1', "$cmd = $conn.CreateCommand()\n$cmd.CommandText = $args[0]\n$n = $cmd.ExecuteNonQueryAsync().Result\n"],
    ['B2 Npgsql BeginTextImport (COPY ... FROM STDIN)', 'scripts/vrogue/b2s.ps1', "$w = $conn.BeginTextImport($args[0])\n$w.Write($rows)\n$w.Dispose()\n"],
    ['B2 SQLAlchemy Table.create', 'scripts/vrogue/b2t.py', `${PY_SQLA}Table('sgu_well', md, schema='env').create(engine)\n`],
    // U30F4 mutation round 2 (the shorthand guard survived): the other ways a QueryConfig names its SQL
    ['B2 node-postgres QueryConfig with a quoted text key', 'scripts/vrogue/b2u.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nawait pool.query({ 'text': process.argv[2]! });\n"],
    ['B2 node-postgres QueryConfig with a text getter', 'scripts/vrogue/b2v.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nawait pool.query({ get text() { return process.argv[2]!; } });\n"],
    ['B2 node-postgres QueryConfig with a static text and a later spread', 'scripts/vrogue/b2w.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst cfg = JSON.parse(process.env.W_Q!);\nawait pool.query({ text: 'SELECT 1', ...cfg });\n"],
    ['B2 node-postgres QueryConfig shorthand after a brace in a string', 'scripts/vrogue/b2x.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst text = process.argv[2]!;\nawait pool.query({ name: '}', text });\n"],
    // U30F4 mutation round 3: a computed key, and a text method beside a static binding of the same name
    ['B2 node-postgres QueryConfig with a computed key', 'scripts/vrogue/b2y.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst key = process.env.W_K!;\nawait pool.query({ [key]: process.argv[2]! });\n"],
    ['B2 node-postgres QueryConfig with a text method beside a static text binding', 'scripts/vrogue/b2z.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst text = 'SELECT 1';\nawait pool.query({ text() { return process.argv[2]!; } });\n"],
  ])('%s -> caught', (_label, file, content) => {
    expect(isScannedPath(file), file).toBe(true);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it.each([
    ['node-postgres QueryConfig with a static text and shorthand values', 'scripts/vrogue/c11.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nconst values = [1];\nawait pool.query({ name: 'one', text: 'SELECT $1::int', values });\n"],
    ['a set add/create in a file without SQLAlchemy', 'scripts/vrogue/c12.py', "import sys\nseen = set()\nseen.add(sys.argv[1])\nclient.create(sys.argv[1])\n"],
    ['node-postgres QueryConfig with braces in its strings and a static text', 'scripts/vrogue/c13.ts', "import pg from 'pg';\nconst pool = new pg.Pool();\nawait pool.query({ name: '{', text: 'SELECT 1' });\n"],
  ])('control: %s passes', (_label, file, content) => {
    expect(problemsOf(file, content)).toEqual([]);
  });

  it('B5: every file type in the repository has a decision -- scanned, an unscanned executable type listed per file, or decided data', () => {
    expect(fileTypeProblems(REPO.files)).toEqual([]);
  });

  it('B5: a new file of a type with no decision, or of an unscanned executable type (.service, .tf, .conf, .ini, .xml) that is not listed, fails', () => {
    for (const f of ['deploy/rogue/wipe.service', 'infra/rogue/main.tf', 'deploy/rogue/pg.conf', 'deploy/rogue/tool.ini', 'deploy/rogue/job.xml', 'tools/rogue/run.newtype']) {
      expect(fileTypeProblems([f]).length, f).toBeGreaterThan(0);
    }
    expect(fileTypeProblems(['docs/rogue/notes.md'])).toEqual([]);
  });

  it('B5: the walk never skips a symbolic link silently -- every link is reported, and only node_modules links are expected', () => {
    const dirent = (name: string, kind: 'dir' | 'file' | 'link') => ({ name, isSymbolicLink: () => kind === 'link', isDirectory: () => kind === 'dir', isFile: () => kind === 'file' });
    const tree: Record<string, ReturnType<typeof dirent>[]> = {
      'virtual-root': [dirent('scripts', 'dir'), dirent('node_modules', 'link')],
      'virtual-root/scripts': [dirent('ok.ts', 'file'), dirent('evil.ts', 'link')],
    };
    const links: string[] = [];
    const rules = { excludedDirNames: [], excludedPrefixes: [], isTestSource: () => false, links, readdir: (dir: string) => tree[dir.replace(/\\/g, '/')] ?? [] };
    expect(walkRepository('virtual-root', rules as never)).toEqual(['scripts/ok.ts']);
    expect([...links].sort()).toEqual(['node_modules', 'scripts/evil.ts']);
    expect(unexpectedLinks(links)).toEqual(['scripts/evil.ts']);
    expect(unexpectedLinks(REPO_LINKS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F5 (verifier U30F3+F4: D-1, D-2, D-5, D-6, D-7, B8, D-11; the cheap known forms closed now)
// ---------------------------------------------------------------------------------------------

/**
 * U30F5 (D-1): the problems of a set of NEW files (path -> text), scanned in memory against the real repository
 * together with the repository files they name (their callers' context changes) and the files they launch.
 */
function problemsOfTree(files: Readonly<Record<string, string>>): Problem[] {
  const realRead = readRepo(REPO_ROOT);
  const read = (p: string): string | null => (Object.prototype.hasOwnProperty.call(files, p) ? files[p]! : realRead(p));
  const texts = new Map(REPO.texts);
  const scans = new Map(REPO.scans);
  for (const [f, text] of Object.entries(files)) {
    expect(fs.existsSync(path.join(REPO_ROOT, f)), `${f} must be new`).toBe(false);
    texts.set(f, text);
    if (isScannedPath(f)) scans.set(f, scanFile(f, text, { readRepoFile: read }));
  }
  const overlay: RepositoryScan = { files: [...new Set([...REPO.files, ...Object.keys(files)])].sort(), scans, texts };
  const ctx = contextFor(overlay);
  const named = REPO.files.filter((f) => Object.values(files).some((t) => t.includes(f)));
  const out: Problem[] = [];
  for (const f of new Set([...Object.keys(files), ...named])) {
    const scan = scans.get(f);
    if (scan) out.push(...evaluateFile(f, texts.get(f)!, scan, ctx));
  }
  // U30F5 (D-1): what the new files launch (their commands and runbook lines), scanned as what it runs as
  const own = Object.keys(files);
  const launchers = [...own.filter((f) => scans.has(f)).map((by) => ({ by, launches: scans.get(by)!.launches })), ...runbookLaunchers(own, read)];
  out.push(...launchProblems(evaluateLaunches(launchers, read, (f) => REPO_FILES.has(f) || Object.prototype.hasOwnProperty.call(files, f)), ctx));
  return out.filter((p) => !p.open);
}

const PG5 = "import pg from 'pg';\nconst pool = new pg.Pool();\n";
const PURGE_TS = `${PG5}await pool.query('TRUNCATE env.sgu_well');\n`;
const npm = (scripts: Record<string, string>) => `${JSON.stringify({ name: 'x', private: true, scripts }, null, 2)}\n`;
const ci = (step: string) => `on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n${step}`;

describe('canaries: U30F5 -- D-1 a file run outside the scan (a launched test source, data file or mis-named script)', () => {
  it.each([
    ['npm script: tsx of a unit-glob *.test.ts', { 'tools/u5a/package.json': npm({ 'ops:purge': 'tsx scripts/ops/unit/purge.test.ts' }), 'scripts/ops/unit/purge.test.ts': PURGE_TS }],
    ['npm script: node --import tsx of a scripts/audit *.test.ts', { 'tools/u5b/package.json': npm({ purge: 'node --import tsx scripts/audit/purge.test.ts' }), 'scripts/audit/purge.test.ts': PURGE_TS }],
    ['CI step: npx tsx of a package *.test.ts', { '.github/workflows/u5c.yml': ci('      - run: npx tsx packages/spatial-provider-postgis/scripts/purge.test.ts\n'), 'packages/spatial-provider-postgis/scripts/purge.test.ts': PURGE_TS }],
    ['Dockerfile RUN: npx tsx of an e2e spec', { 'deploy/u5d/Dockerfile': 'FROM node:22\nRUN npx tsx tests/e2e/purge.spec.ts\n', 'tests/e2e/purge.spec.ts': PURGE_TS }],
    ['shell script: tsx of a unit-glob *.test.ts', { 'scripts/ops/u5e.sh': '#!/bin/sh\ntsx scripts/ops/unit/purge.test.ts\n', 'scripts/ops/unit/purge.test.ts': PURGE_TS }],
    ['JS process call: execSync of npx tsx *.test.ts', { 'scripts/ops/u5f.ts': "import { execSync } from 'node:child_process';\nexecSync('npx tsx scripts/ops/unit/purge.test.ts');\n", 'scripts/ops/unit/purge.test.ts': PURGE_TS }],
    ['runbook: a fenced bash line runs a *.test.ts', { 'docs/ops/u5g-runbook.md': '# Purge\n\n```bash\nnpx tsx scripts/ops/unit/purge.test.ts\n```\n', 'scripts/ops/unit/purge.test.ts': PURGE_TS }],
    ['npm script: bash of a .txt', { 'tools/u5h/package.json': npm({ wipe: 'bash scripts/ops/wipe-sh.txt' }), 'scripts/ops/wipe-sh.txt': 'psql "$DB" -c "TRUNCATE env.sgu_well"\n' }],
    ['npm script: python of a .md', { 'tools/u5i/package.json': npm({ wipe: 'python scripts/ops/wipe-py.md' }), 'scripts/ops/wipe-py.md': "import os, psycopg2\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\n" }],
    ['npm script: python of a .sh (run as Python, not shell)', { 'tools/u5j/package.json': npm({ wipe: 'python scripts/ops/wipe2.sh' }), 'scripts/ops/wipe2.sh': "import os, psycopg2\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\n" }],
    ['npm script: a data file executed directly', { 'tools/u5k/package.json': npm({ wipe: './scripts/ops/wipe3.txt' }), 'scripts/ops/wipe3.txt': '#!/bin/sh\npsql -c "$SQL"\n' }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfTree(files).length).toBeGreaterThan(0);
  });

  it.each([
    ['npm script: tsx of a test source that writes nothing (scanned, no site)', { 'tools/u5l/package.json': npm({ hello: 'tsx scripts/ops/unit/hello.test.ts' }), 'scripts/ops/unit/hello.test.ts': "console.log('hello');\n" }],
    ['npm script: vitest runs a test source (its runner, behind TEST-DB-GUARD)', { 'tools/u5m/package.json': npm({ t: 'vitest run scripts/ops/unit/purge.test.ts' }), 'scripts/ops/unit/purge.test.ts': PURGE_TS }],
    ['npm script: bash of a .txt that runs no DB tool', { 'tools/u5n/package.json': npm({ hello: 'bash scripts/ops/hello.txt' }), 'scripts/ops/hello.txt': 'echo hello\n' }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfTree(files)).toEqual([]);
  });

  it('D-11: a TEST_HARNESS file reached from a package.json script (not a runner configuration) fails', () => {
    const problems = problemsOfTree({ 'tools/u5o/package.json': npm({ seed: 'tsx tests/helpers/postgisSeed.ts' }) });
    expect(problems.some((p) => p.file === 'tests/helpers/postgisSeed.ts' && /TEST_HARNESS/.test(p.problem)), JSON.stringify(problems)).toBe(true);
  });
});

describe('canaries: U30F5 -- D-2 inline code, D-5 substituted SQL, D-6 process and GDAL modules, D-7 CASCADE, D-3/D-4/B8', () => {
  it.each([
    ['D-2 npm script: node -e running a command from the environment (N15)', 'tools/u5p/package.json', npm({ wipe: "node -e \"require('child_process').execSync(process.env.CMD)\"" })],
    ['D-2 npm script: node -e with a dynamic pool.query', 'tools/u5q/package.json', npm({ wipe: "node -e \"const pool = new (require('pg').Pool)(); pool.query(process.argv[1])\"" })],
    ['D-2 Dockerfile RUN python -c with a dynamic execute (N72)', 'deploy/u5r/Dockerfile', "FROM python:3.12\nRUN python -c \"import os,psycopg2; psycopg2.connect('').cursor().execute(os.environ['SQL'])\"\n"],
    ['D-2 CI step with shell: python and a dynamic execute (N70)', '.github/workflows/u5s.yml', ci("      - shell: python\n        run: |\n          import os, psycopg2\n          psycopg2.connect(os.environ['DB']).cursor().execute(os.environ['SQL'])\n")],
    ['D-2 CI step with shell: python, shell after run', '.github/workflows/u5t.yml', ci("      - name: wipe\n        run: |\n          import os, psycopg2\n          psycopg2.connect('').cursor().execute(os.environ['SQL'])\n        shell: python\n")],
    ['D-2 CI defaults run shell: pwsh with Npgsql', '.github/workflows/u5u.yml', 'on: push\ndefaults:\n  run:\n    shell: pwsh\njobs:\n  x:\n    runs-on: windows-latest\n    steps:\n      - run: |\n          $cmd = $conn.CreateCommand()\n          $cmd.CommandText = $env:SQL\n          $cmd.ExecuteNonQuery()\n'],
    ['D-2 npm script: pwsh -Command with Npgsql ExecuteNonQuery', 'tools/u5v/package.json', npm({ wipe: 'pwsh -NoProfile -Command "$c = $conn.CreateCommand(); $c.CommandText = $env:SQL; $c.ExecuteNonQuery()"' })],
    ['D-5 .cmd for /f loop feeding psql (N45)', 'scripts/vrogue/u5w.cmd', '@echo off\r\nfor /f "delims=" %%i in (wipe.txt) do psql -c "%%i"\r\n'],
    ['D-5 sh: xargs -I{} psql -c (N44)', 'scripts/vrogue/u5x.sh', "#!/bin/sh\ncat stmts.txt | xargs -I{} psql -c '{}'\n"],
    ['D-6 zx $ used as a value (N07)', 'scripts/vrogue/u5y.mjs', "import { $ } from 'zx';\nconst run = $;\nawait run`psql -c ${process.argv[2]}`;\n"],
    ['D-6 execa renamed import (N08)', 'scripts/vrogue/u5z.ts', "import { execaCommand as run } from 'execa';\nawait run(process.argv[2]!);\n"],
    ['D-6 osgeo gdal.VectorTranslate into PG (N26)', 'scripts/vrogue/u6a.py', "from osgeo import gdal\ngdal.VectorTranslate('PG:dbname=x', 'a.gpkg', layerName='env.sgu_well', accessMode='overwrite')\n"],
    ['D-6 pyogrio.write_dataframe to PG (N27)', 'scripts/vrogue/u6b.py', "import pyogrio\npyogrio.write_dataframe(gdf, 'PG:dbname=x', layer='sgu_well', layer_options={'SCHEMA': 'env'})\n"],
    ['D-6 polars write_database replace (N25)', 'scripts/vrogue/u6c.py', "import polars as pl\npl.DataFrame({'a': [1]}).write_database('env.sgu_well', 'postgresql://x', if_table_exists='replace')\n"],
    ['D-6 fiona open of a PG layer', 'scripts/vrogue/u6d.py', "import fiona\nwith fiona.open('PG:dbname=x', 'w', layer='env.sgu_well') as dst:\n    pass\n"],
    ['D-6 from osgeo import ogr', 'scripts/vrogue/u6e.py', "from osgeo import ogr\nogr.Open('PG:dbname=x', 1).ExecuteSQL('TRUNCATE ' + table)\n"],
    ['D-7 pool.query TRUNCATE of an unprotected parent CASCADE (N53)', 'scripts/vrogue/u6f.ts', `${PG5}await pool.query('TRUNCATE public.parent CASCADE');\n`],
    ['D-7 SQL file: DROP of the N-1 base CASCADE (N54)', 'docs/ops/u6g.sql', 'DROP TABLE env.sgu_well_actual CASCADE;\n'],
    ['D-7 sh: psql -c DROP TYPE CASCADE', 'scripts/vrogue/u6h.sh', '#!/bin/sh\npsql "$DB" -c "DROP TYPE public.t CASCADE"\n'],
    ['D-3 SQL file: COPY (SELECT 1) TO PROGRAM (N56)', 'docs/ops/u6i.sql', "COPY (SELECT 1) TO PROGRAM 'sh /tmp/x.sh';\n"],
    ['D-4 SQL file: CREATE FOREIGN TABLE over env.sgu_well (N63)', 'docs/ops/u6j.sql', "CREATE FOREIGN TABLE public.f (id int) SERVER loopback OPTIONS (schema_name 'env', table_name 'sgu_well');\n"],
    ['B8 SQL file: GRANT ALL ON env.sgu_well TO PUBLIC (N64)', 'docs/ops/u6k.sql', 'GRANT ALL ON env.sgu_well TO PUBLIC;\n'],
  ])('%s -> caught', (_label, file, content) => {
    expect(isScannedPath(file), file).toBe(true);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it.each([
    ['D-2 npm script: node -e that logs', 'tools/u6l/package.json', npm({ hello: 'node -e "console.log(1)"' })],
    ['D-2 CI step with shell: python that prints', '.github/workflows/u6m.yml', ci("      - shell: python\n        run: |\n          print('hello')\n")],
    ['D-2 Dockerfile RUN python -c that prints', 'deploy/u6n/Dockerfile', 'FROM python:3.12\nRUN python -c "print(1)"\n'],
    ['D-6 geopandas read_file (a reader, not a GDAL writer)', 'scripts/vrogue/u6o.py', "import geopandas as gpd\ngdf = gpd.read_file('a.gpkg')\n"],
    ['D-7 a gated TRUNCATE ... CASCADE (the gate judges its targets)', 'scripts/vrogue/u6p.ts', `${PG5}import { gatedSql } from '../../packages/spatial-provider-postgis/src/ProtectedRelationGate';\nawait pool.query(gatedSql('scripts/vrogue/u6p.ts', 'TRUNCATE public.parent CASCADE'));\n`],
    ['D-7 SQL file: a foreign key ON DELETE CASCADE', 'docs/ops/u6q.sql', 'ALTER TABLE public.c ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES public.p (id) ON DELETE CASCADE;\n'],
  ])('control: %s passes', (_label, file, content) => {
    expect(problemsOf(file, content)).toEqual([]);
  });

  // U30F5 mutation round 1: what the first canaries left unexercised
  it.each([
    ['D-2 Dockerfile exec form: pwsh -Command with Npgsql ExecuteNonQuery', 'deploy/u7a/Dockerfile', 'FROM mcr.microsoft.com/powershell\nCMD ["pwsh", "-NoProfile", "-Command", "$c = $conn.CreateCommand(); $c.CommandText = $env:SQL; $c.ExecuteNonQuery()"]\n'],
    ['D-2 CI defaults run shell: python with a dynamic execute', '.github/workflows/u7b.yml', "on: push\ndefaults:\n  run:\n    shell: python\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          import os, psycopg2\n          psycopg2.connect(os.environ['DB']).cursor().execute(os.environ['SQL'])\n"],
    ['D-2 CI step with a shell the scan does not read (perl)', '.github/workflows/u7c.yml', ci('      - shell: perl {0}\n        run: |\n          system($ENV{CMD});\n')],
    ['D-7 a process call runs psql -c with an ungated CASCADE (only the command channel reads it)', 'scripts/vrogue/u7g.ts', "import { execSync } from 'node:child_process';\nexecSync('psql -c \"TRUNCATE public.parent CASCADE\"');\n"],
  ])('%s -> caught', (_label, file, content) => {
    expect(isScannedPath(file), file).toBe(true);
    expect(problemsOf(file, content).length).toBeGreaterThan(0);
  });

  it.each([
    ['D-1 a package.json in a package directory runs a test source relative to it', { 'packages/spatial-provider-postgis/scripts/package.json': npm({ purge: 'tsx purge.test.ts' }), 'packages/spatial-provider-postgis/scripts/purge.test.ts': PURGE_TS }],
    ['D-1 a launched data file launches a test source in turn', { 'tools/u7e/package.json': npm({ go: 'bash scripts/ops/u7e.txt' }), 'scripts/ops/u7e.txt': 'tsx scripts/ops/unit/purge.test.ts\n', 'scripts/ops/unit/purge.test.ts': PURGE_TS }],
    ['D-1 an npm script runs a file in a path the scan excludes', { 'tools/u7f/package.json': npm({ go: 'node public/cesium/u7f.js' }), 'public/cesium/u7f.js': "require('child_process').execSync(process.env.CMD);\n" }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfTree(files).length).toBeGreaterThan(0);
  });

  it("a PowerShell relation gate still counts -- shown on an appended drop without CASCADE (sanitize's own drops are open D-7 sites, UNRESOLVABLE with or without it)", () => {
    const file = 'scripts/import/sanitize-postgis-failed-imports.ps1';
    const original = realText(file);
    const gate = "    Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP' -Relation $u\n";
    const appended = `${original}\nforeach ($u in $args) {\n${gate}    Invoke-DbSql "DROP TABLE IF EXISTS $u;" 'u30f5'\n}\n`;
    expect(problemsOf(file, appended)).toEqual([]);
    expect(problemsOf(file, appended.replace(gate, '')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Generated violations: languages x channels x relations x obfuscations x paths
// ---------------------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedCase {
  readonly id: string;
  readonly file: string;
  readonly content: string;
  readonly violation: boolean;
}

/** Name renderings PostgreSQL resolves to the same relation. */
function renderName(rand: () => number, relation: string, quotable: boolean): string {
  const [schema, table] = relation.split('.') as [string, string];
  const forms = [
    () => relation,
    () => relation.toUpperCase(),
    () => `${schema[0]!.toUpperCase()}${schema.slice(1)}.${table.toUpperCase()}`,
    ...(quotable ? [() => `"${schema}"."${table}"`, () => `"${schema}".${table}`] : []),
  ];
  return forms[Math.floor(rand() * forms.length)]!();
}

function generateCases(seed: number, count: number): GeneratedCase[] {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const relations = [
    ...PROTECTED_RELATIONS.relations.map((r) => r.relation),
    'lm_staging.flood_risk_area_994bf11c',
    'lm_staging.natura2000_area_0123456789abcdef01234567',
  ];
  const writes = [
    (n: string) => `TRUNCATE ${n}`,
    (n: string) => `TRUNCATE TABLE ONLY ${n} CASCADE`,
    (n: string) => `DELETE FROM ${n}`,
    (n: string) => `DROP TABLE IF EXISTS ${n} CASCADE`,
    (n: string) => `UPDATE ${n} SET geom = NULL`,
    (n: string) => `INSERT INTO ${n} SELECT * FROM public.scratch`,
    (n: string) => `ALTER TABLE ${n} RENAME TO x_old`,
    (n: string) => `CREATE OR REPLACE VIEW ${n} AS SELECT 1`,
  ];
  const reads = [(n: string) => `SELECT count(*) FROM ${n}`, (n: string) => `SELECT * FROM ${n} WHERE id = 1`];
  const allowedWrites = [(i: number) => `TRUNCATE public.scratch_${i}`, (i: number) => `INSERT INTO public.scratch_${i} VALUES (1)`];
  const obfuscate = [
    (s: string) => s,
    (s: string) => `/* maintenance */ ${s}`,
    (s: string) => `-- maintenance\n${s}`,
    (s: string) => s.replace(' ', '\n   '),
    (s: string) => `SELECT 1; ${s}`,
  ];
  const dirs = ['scripts/rogue', 'scripts/test', 'scripts/.hidden', 'server/rogue', 'tools', 'packages/rogue/src', 'deploy/gen', 'gen'];
  const js = (s: string) => JSON.stringify(s);
  const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
  type Channel = { id: string; ext: string; multiline: boolean; quotes: boolean; ogr?: boolean; render: (sql: string, name: string) => string; fileName?: string };
  const channels: Channel[] = [
    { id: 'ts-prisma', ext: '.ts', multiline: true, quotes: true, render: (s) => `${PRISMA}await p.$executeRawUnsafe(${js(s)});\n` },
    { id: 'ts-pg-variable', ext: '.mts', multiline: true, quotes: true, render: (s) => `import pg from 'pg';\nconst q = ${js(s)};\nawait new pg.Pool().query(q);\n` },
    { id: 'ts-concat', ext: '.ts', multiline: false, quotes: true, render: (s) => { const k = 1 + Math.floor(rand() * (s.length - 2)); return `${PRISMA}await p.$executeRawUnsafe(${js(s.slice(0, k))} + ${js(s.slice(k))});\n`; } },
    { id: 'ts-template-constant', ext: '.ts', multiline: false, quotes: false, render: (s) => `${PRISMA}const verb = ${js(s.split(' ')[0]!)};\nawait p.$executeRawUnsafe(\`\${verb} ${s.split(' ').slice(1).join(' ')}\`);\n` },
    { id: 'js-exec-psql', ext: '.cjs', multiline: false, quotes: false, render: (s) => `const { execSync } = require('node:child_process');\nexecSync(${js(`psql -c "${s}"`)});\n` },
    { id: 'ts-spawn-psql', ext: '.ts', multiline: true, quotes: true, render: (s) => `import { spawnSync } from 'node:child_process';\nspawnSync('psql', ['-v', 'ON_ERROR_STOP=1', '-c', ${js(s)}]);\n` },
    { id: 'ts-spawn-ogr2ogr', ext: '.ts', multiline: false, quotes: false, ogr: true, render: (_s, n) => `import { spawnSync } from 'node:child_process';\nconst args = ['-f', 'PostgreSQL', 'PG:dbname=x', 'a.gpkg', '-nln', ${js(n)}, '-overwrite'];\nspawnSync('ogr2ogr', args);\n` },
    { id: 'py-cursor', ext: '.py', multiline: true, quotes: true, render: (s) => `import psycopg2\nconn = psycopg2.connect('')\ncur = conn.cursor()\ncur.execute(${js(s)})\n` },
    { id: 'py-subprocess-psql', ext: '.py', multiline: true, quotes: true, render: (s) => `import subprocess\nsql = ${js(s)}\nsubprocess.run(['psql', '-c', sql], check=True)\n` },
    { id: 'py-fstring', ext: '.py', multiline: false, quotes: false, render: (s) => `import psycopg2\ncur = psycopg2.connect('').cursor()\nverb = ${js(s.split(' ')[0]!)}\ncur.execute(f"{verb} ${s.split(' ').slice(1).join(' ')}")\n` },
    { id: 'ps-psql', ext: '.ps1', multiline: true, quotes: true, render: (s) => `$sql = ${sq(s)}\n& psql -v ON_ERROR_STOP=1 -c $sql\n` },
    { id: 'ps-literal-invoke', ext: '.ps1', multiline: false, quotes: true, render: (s) => `& 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe' -c ${sq(s)}\n` },
    { id: 'sh-psql', ext: '.sh', multiline: true, quotes: false, render: (s) => `#!/bin/sh\nset -e\npsql "$DATABASE_URL" -c '${s}'\n` },
    { id: 'sh-heredoc', ext: '.sh', multiline: true, quotes: true, render: (s) => `#!/bin/bash\npsql "$DATABASE_URL" <<'SQL'\n${s};\nSQL\n` },
    { id: 'cmd-psql', ext: '.cmd', multiline: false, quotes: false, render: (s) => `@echo off\r\npsql -c "${s}"\r\n` },
    { id: 'sql-file', ext: '.sql', multiline: true, quotes: true, render: (s) => `-- generated\n${s};\n` },
    { id: 'yaml-run', ext: '.yml', multiline: false, quotes: false, render: (s) => `jobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - name: step\n        run: psql -c '${s}'\n` },
    { id: 'yaml-block', ext: '.yaml', multiline: false, quotes: false, render: (s) => `steps:\n  - name: step\n    run: |\n      set -e\n      psql -c '${s}'\n` },
    { id: 'npm-script', ext: '', multiline: false, quotes: false, fileName: 'package.json', render: (s) => `${JSON.stringify({ name: 'gen', scripts: { wipe: `psql -c '${s}'` } }, null, 2)}\n` },
    { id: 'dockerfile', ext: '', multiline: false, quotes: false, fileName: 'Dockerfile', render: (s) => `FROM postgres:16\nRUN psql -c '${s}' \\\n  && echo done\n` },
    { id: 'toml', ext: '.toml', multiline: false, quotes: false, render: (s) => `[deploy]\nrelease_command = "psql -c '${s}'"\n` },
  ];
  const out: GeneratedCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const ch = pick(channels);
    const violation = rand() < 0.6;
    const relation = pick(relations);
    const name = renderName(rand, relation, ch.quotes && !ch.ogr);
    let sql: string;
    let nameForOgr = name;
    if (violation) {
      sql = pick(writes)(name);
      if (ch.multiline) sql = pick(obfuscate)(sql);
    } else if (rand() < 0.5) {
      sql = pick(reads)(name);
      nameForOgr = `public.scratch_${i}`;
    } else {
      sql = pick(allowedWrites)(i);
      nameForOgr = `public.scratch_${i}`;
    }
    const file = `${pick(dirs)}/${ch.fileName ? `g${i}/${ch.fileName}` : `gen-${i}${ch.ext}`}`;
    out.push({ id: `${i} ${ch.id} ${violation ? 'VIOLATION' : 'control'} ${ch.ogr ? nameForOgr : sql.replace(/\s+/g, ' ')}`, file, content: ch.render(sql, nameForOgr), violation });
  }
  return out;
}

describe('canaries: generated new violations are all caught, generated controls all pass (seeded)', () => {
  const cases = generateCases(20261002, 420);

  it('the generator covers every channel kind with violations and controls', () => {
    const kinds = new Set(cases.map((c) => c.id.split(' ')[1]));
    expect(kinds.size).toBeGreaterThanOrEqual(21);
    expect(cases.filter((c) => c.violation).length).toBeGreaterThan(200);
    expect(cases.filter((c) => !c.violation).length).toBeGreaterThan(100);
  });

  it('every generated violation is caught and every control passes', () => {
    const missed: string[] = [];
    const falseAlarms: string[] = [];
    for (const c of cases) {
      if (!isScannedPath(c.file)) {
        missed.push(`not scanned: ${c.file}`);
        continue;
      }
      const problems = problemsOf(c.file, c.content);
      if (c.violation && problems.length === 0) missed.push(`${c.id} @ ${c.file}`);
      if (!c.violation && problems.length > 0) falseAlarms.push(`${c.id} @ ${c.file}: ${problems[0]!.problem}`);
    }
    expect(missed).toEqual([]);
    expect(falseAlarms).toEqual([]);
  });
});
