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
import { PACKAGE_JSON_PINNED_FIELDS, commandRuns, languageOf, nodeOptionsRuns, scanFile, walkRepository, type ChannelSite, type FileScan, type Language, type Launch } from './protectedWriteChannels';
import * as channels from './protectedWriteChannels';
import {
  FILE_TYPE_DECISIONS,
  GATE_IMPLEMENTATION,
  HISTORICAL_SQL,
  PATH_EXCLUSIONS,
  REVIEWED_CHANNELS,
  REVIEW_MARKER_DOORS,
  TEST_SOURCES,
  UNRESOLVED_LAUNCH_CATEGORIES,
  UNRESOLVED_LAUNCHES,
  UNSCANNED_EXECUTABLES,
  UNSCANNED_EXECUTABLE_TYPES,
  type ReviewedChannels,
} from './protectedWriteChannels.reviewed';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------------------------
// Locks: every reviewed list is pinned. A change of a list is a reviewed change of this file too.
// ---------------------------------------------------------------------------------------------

const LOCKS = {
  reviewedEntries: 75,
  reviewedSites: 162,
  reviewedSha256: 'a3a3fff8ca4fff7fd6b3f03f20fcd454e111e54a071ca7914cc050efe91c049f',
  historicalFiles: 10,
  historicalSha256: 'a1ac41e6db406040b8cd6226c3701534a8bedd97ebc03add995f44661c29a19c',
  gateImplementationSha256: '8e4c1728b341ad514847e9cb4e2e9f4046607f95d059c9a87c119ac505ce98bd',
  pathExclusionsSha256: '4becd2b0307d48979f6cd9428aa35b4fff76df21c9bcd571effefaf2a67583f7',
  unscannedSha256: 'f860776a464e23399d4f996737d917154ef3cc12cd3a7f56b2e834d65d24fddd',
  testSourcesSha256: '42f868346e882e2a4a9cc20db07e20782b24e553633d550933d1aeff815a67d5',
  retiredCount: 20,
  // U30F2 LOW (verifier L3): the retired list is pinned by content too -- an entry swapped for another
  // with the same count, or an entry's relations, justification or replacement changed, fails here.
  retiredSha256: 'bf8aa6f8e83cbd59a0e510d1af87754d8db9d90bd67bea2562de8f76f6843036',
  // U30F3 (verifier L-1): the closed list of gate doors a reviewed marker may name
  markerDoorsSha256: '806f99ebb2450096d501ba639356a17768d989e541c3a630c98d7ca04bab32a6',
  // U30F4 (B5): the file types decided to be data
  fileTypeDecisionsSha256: '490bbe38db7f2569773f3de5140e8135271c9bce57a5bbfd4e1578ed2819aa40',
  // U30F5 (D-7): the open owner decisions (BLOCKERARE, failed by their own test)
  openDecisionsSha256: '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  // U30F6 (F5-3): the reviewed launches that resolve to no repository file (and their category arguments)
  unresolvedLaunches: 61,
  unresolvedLaunchesSha256: 'c3bdd597f537b4de15842f312ef7fbcd2d44dbdd0fce3e64fb8345b9dac08ad4',
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
// U30F7 (owner decision 2026-10-03): all seven sites are closed -- cleanup-db.ts and sanitize-postgis-failed-imports.ps1
// are retired entry points that are nothing but their refusal (RETIRED_ENTRYPOINT_ONLY), fill-empty-gaps-from-archive.ts
// drops without CASCADE through gatedSql. No open decision remains; a new one is a reviewed edit of this list.
const OPEN_OWNER_DECISIONS: Readonly<Record<string, readonly string[]>> = {};

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
  if (file.endsWith('.ps1')) {
    // U30F7: a retired PowerShell entry point writes its refusal to stderr and exits non-zero before any other statement
    const lines = code.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
    if (!lines[0]?.startsWith(`[Console]::Error.WriteLine('REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ${file} `) || !/^exit\s+[1-9][0-9]*$/.test(lines[1] ?? '')) {
      return 'retired PowerShell without its refusal first (REJECT_RETIRED_DESTRUCTIVE_SCRIPT to stderr, then exit non-zero)';
    }
    return null;
  }
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const refusal = stripped.indexOf(`refuseRetiredDestructiveScript('${file}')`);
  const firstUse = stripped.search(/new PrismaClient\(|\$executeRaw|\$queryRaw|\bspawn(?:Sync)?\(|\bexec(?:File)?Sync\(|\.query\(|\bmain\(\)|\bverify\(\)|\brunBenchmark\(\)/);
  if (refusal < 0 || (firstUse >= 0 && firstUse < refusal)) return 'retired but not refused before its first database or process call';
  return null;
}

/**
 * U30F7 (owner decision 2026-10-03): retired entry points that are NOTHING but their refusal, pinned by content
 * (sha256 of the text, line endings normalised): a line added to them -- a new CASCADE site, a DROP -- fails.
 */
const RETIRED_ENTRYPOINT_ONLY: Readonly<Record<string, string>> = {
  'scripts/db/cleanup-db.ts': 'e3065955fb9834d009f649a8aa1442b2e86cf120259ba0b9bb3f788983c27948',
  'scripts/import/sanitize-postgis-failed-imports.ps1': 'eb341213dc994e7ee0ff3fdb6baaccdfae8fd0de018a327012168fa89eb5c4b0',
};

/** U30F9 (G8-9): the re-review procedure every content-pin failure points at. */
const REREVIEW_DOC = 'docs/architecture/U30-PROTECTED-WRITE-INVENTORY-REREVIEW.md';

/**
 * U30F8 (G6-2): what a reviewed DYNAMIC entry pins -- the text the scan reads of the file: a package.json's command-bearing
 * fields (U30F9 G8-7: `scripts`, `bin`, `config` and the hook fields -- PACKAGE_JSON_PINNED_FIELDS -- in that order; a new
 * dependency is no new call path), every other file whole (line endings normalised: CRLF and LF pin alike, G8-9).
 */
function reviewedContentSha(file: string, text: string): string {
  if (file.split('/').pop()!.toLowerCase() === 'package.json') {
    let pinned: Record<string, unknown> | null = null;
    try {
      const doc = JSON.parse(text) as Record<string, unknown>;
      pinned = {};
      for (const field of PACKAGE_JSON_PINNED_FIELDS) if (doc[field] !== undefined) pinned[field] = doc[field];
    } catch {
      pinned = null;
    }
    if (pinned !== null) return createHash('sha256').update(JSON.stringify(pinned)).digest('hex');
  }
  return normalisedSha(text);
}

/** U30F9 (G8-9): the problem text of a content-pin mismatch -- it names the procedure and exactly what to do. */
function pinMismatch(file: string, pin: string, pinned: string | undefined): string {
  return (
    `a reviewed DYNAMIC file changed (content sha256 ${pin}, pinned ${pinned ?? 'none'}) -- U30 re-review required (${REREVIEW_DOC}): ` +
    `in the SAME commit, (1) re-read ${file} and check that its reviewed sites and justification still hold (update them if not), ` +
    `(2) set contentSha256 to ${pin} in tests/unit/protectedWriteChannels.reviewed.ts, (3) set reviewedOn to today's date and reviewedBy to yourself, ` +
    `(4) write "U30 re-review: ${file}" in the commit message; the U30 track / a CODEOWNER approves before merge (U30F8 G6-2, U30F9 G8-9)`
  );
}

/** Every problem of one file, given its scan. */
function evaluateFile(file: string, text: string, scan: FileScan, ctx: EvaluationContext): Problem[] {
  const problems: Problem[] = [];
  const add = (problem: string) => problems.push({ file, problem });
  if (GATE_FILES.has(file)) return problems;
  if (ctx.retired.has(file)) {
    const why = retiredRefusesFirst(file, text);
    if (why) add(why);
    // U30F7: an entry point retired as nothing but its refusal stays exactly that (a new line in it is a new site)
    const only = RETIRED_ENTRYPOINT_ONLY[file];
    if (only !== undefined && normalisedSha(text) !== only) add(`a retired entry point that is pinned as nothing but its refusal changed (sha256 ${normalisedSha(text)}, U30F7): nothing may be added to it`);
    return problems;
  }
  const historical = ctx.historical.get(file);
  if (historical) {
    if (normalisedSha(text) !== historical.sha256) add(`historical SQL changed (sha256 ${normalisedSha(text)}): a pinned migration is never edited; write a new governed one`);
    return problems;
  }
  const entry = ctx.reviewed.get(file);
  // U30F8 (G6-2): a reviewed DYNAMIC file is pinned by content -- a new call path in it (a helper call to a test source,
  // a data file, process.argv) is never invisible: any change fails until the entry is reviewed again and re-pinned
  if (entry?.policy === 'DYNAMIC_REVIEWED') {
    const pin = reviewedContentSha(file, text);
    if (entry.contentSha256 !== pin) add(pinMismatch(file, pin, entry.contentSha256));
  }
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

/**
 * A launch's file in the repository: relative to the launcher's directory, else to the repository root. A module
 * (`python -m a.b`) is `a/b.py` or `a/b/__main__.py`. U30F6 (F5-4): the static tail of a path in a dynamic directory
 * is every repository file ending in it -- each may be the one run, so each is scanned as run.
 */
function resolveLaunch(by: string, l: Pick<Launch, 'file' | 'module' | 'suffix' | 'package'>, files: ReadonlySet<string>): string[] {
  if (l.package) return []; // a package's module (node -r/--import <specifier>) is never a repository file
  if (l.suffix) return [...files].filter((f) => f === l.file || f.endsWith(`/${l.file}`)).sort();
  const names = l.module ? [`${l.file}.py`, `${l.file}/__main__.py`] : [l.file];
  const candidates = names.flatMap((n) => [path.posix.normalize(path.posix.join(path.posix.dirname(by), n)), path.posix.normalize(n)]);
  const found = [...new Set(candidates)].filter((c) => !c.startsWith('..') && !c.startsWith('/') && files.has(c));
  // a path above a working directory the source does not name (`..\scripts\x.ps1` in a runbook): its static tail, as F5-4
  const above = /^(\.\.\/)+(.+)$/.exec(path.posix.normalize(l.file));
  if (found.length === 0 && above && !l.module) return resolveLaunch(by, { file: above[2]!, suffix: true }, files);
  return found;
}

/** U30F6 (F5-3): a launch that resolves to no repository file, as the reviewed list names it. */
interface UnresolvedLaunch {
  readonly by: string;
  readonly runs: string;
  readonly via: string;
}

function unresolvedKey(u: { by: string; runs: string }): string {
  return `${u.by} -> ${u.runs}`;
}

const UNRESOLVED_REVIEWED = new Set(UNRESOLVED_LAUNCHES.map(unresolvedKey));

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
  files: ReadonlySet<string>,
): { launched: LaunchedScan[]; problems: Problem[]; unresolved: UnresolvedLaunch[] } {
  const queue: { by: string; l: Launch }[] = launchers.flatMap((e) => e.launches.map((l) => ({ by: e.by, l })));
  const seen = new Set<string>();
  const launched: LaunchedScan[] = [];
  const problems: Problem[] = [];
  const unresolved = new Map<string, UnresolvedLaunch>();
  while (queue.length) {
    const { by, l } = queue.shift()!;
    const found = resolveLaunch(by, l, files);
    // U30F6 (F5-3): a launch no repository file answers is never dropped silently -- it is reviewed or it fails
    if (found.length === 0) {
      const u: UnresolvedLaunch = { by, runs: l.package ? `preload ${l.file}` : l.module ? `python -m ${l.file.replace(/\//g, '.')}` : l.suffix ? `<dynamic directory>/${l.file}` : l.file, via: l.via };
      if (!unresolved.has(unresolvedKey(u))) unresolved.set(unresolvedKey(u), u);
    }
    for (const f of found) {
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
  return { launched, problems, unresolved: [...unresolved.values()] };
}

/**
 * The problems of the launched scans (each scanned as what it runs as), of the launches themselves, and (U30F6 F5-3)
 * of every launch that resolves to no repository file and is not a reviewed entry of UNRESOLVED_LAUNCHES.
 */
function launchProblems(result: { launched: LaunchedScan[]; problems: Problem[]; unresolved: UnresolvedLaunch[] }, ctx: EvaluationContext): Problem[] {
  const out: Problem[] = [...result.problems];
  for (const u of result.unresolved) {
    if (!UNRESOLVED_REVIEWED.has(unresolvedKey(u))) out.push({ file: u.by, problem: `runs ${u.runs}, which resolves to no repository file and is not a reviewed unresolved launch (U30F6 F5-3) -- ${u.via}` });
  }
  for (const l of result.launched) out.push(...evaluateFile(l.file, l.text, l.scan, ctx).map((p) => ({ ...p, problem: `${p.problem} -- ${l.by}` })));
  return out;
}

const REPO_FILES = new Set(REPO.files);
/**
 * U30F8 (G6-5): NODE_OPTIONS in an environment file (.env, .env.*: dotenv -e, compose env_file) -- every node process
 * started with it preloads what it names. Its preloads are launches of the file; options the source does not hold fail.
 */
function envFileRuns(files: readonly string[], read: (p: string) => string | null): { launchers: { by: string; launches: Launch[] }[]; problems: Problem[] } {
  const launchers: { by: string; launches: Launch[] }[] = [];
  const problems: Problem[] = [];
  for (const f of files) {
    if (!/^\.env/.test(f.split('/').pop()!) || EXCLUDED.some((re) => re.test(f))) continue;
    const text = read(f);
    if (text === null) continue;
    const launches: Launch[] = [];
    for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
      const m = /^\s*(?:export\s+)?NODE_OPTIONS\s*=\s*(.*)$/.exec(raw);
      if (!m) continue;
      const v = m[1]!.trim();
      const value = /^(["']).*\1$/.test(v) ? v.slice(1, -1) : v;
      const runs = nodeOptionsRuns(value);
      for (const l of runs.launches) launches.push({ ...l, via: raw.trim().slice(0, 160) });
      for (const d of runs.dynamic) problems.push({ file: f, problem: `${d} -- ${raw.trim().slice(0, 160)}` });
    }
    if (launches.length) launchers.push({ by: f, launches });
  }
  return { launchers, problems };
}

/**
 * U30F9 (G8-8): the package-manager configuration files that start code for every npm/yarn run -- `.npmrc` `node-options`
 * (NODE_OPTIONS of every npm script), `script-shell` (the shell npm runs scripts with) and `onload-script` (a module npm loads),
 * `.yarnrc.yml` `yarnPath` and `.yarnrc` `yarn-path` (the yarn release file node runs). Each is a launch of the named file (or
 * NODE_OPTIONS read as node flags); a value the source does not hold fails. A `.nvmrc` / `.node-version` names a version, not a
 * file, and is not read.
 */
function rcFileRuns(files: readonly string[], read: (p: string) => string | null): { launchers: { by: string; launches: Launch[] }[]; problems: Problem[] } {
  const launchers: { by: string; launches: Launch[] }[] = [];
  const problems: Problem[] = [];
  for (const f of files) {
    const base = f.split('/').pop()!;
    if (!/^\.npmrc$|^\.yarnrc(\.yml)?$/.test(base) || EXCLUDED.some((re) => re.test(f))) continue;
    const text = read(f);
    if (text === null) continue;
    const launches: Launch[] = [];
    const unquote = (v: string) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);
    for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
      const line = raw.replace(/^\s*(#|;|\/\/).*$/, '').trim();
      if (!line) continue;
      if (base === '.npmrc') {
        const m = /^(node[-_]options|script-shell|onload-script)\s*=\s*(.*)$/i.exec(line);
        if (!m) continue;
        const key = m[1]!.toLowerCase().replace('_', '-');
        const value = unquote(m[2]!.trim());
        if (key === 'node-options') {
          const runs = nodeOptionsRuns(value);
          for (const l of runs.launches) launches.push({ ...l, via: `${base}: ${raw.trim().slice(0, 160)}` });
          for (const d of runs.dynamic) problems.push({ file: f, problem: `${d} -- ${base}: ${raw.trim().slice(0, 160)}` });
        } else if (value) launches.push({ file: value.replace(/\\/g, '/'), lang: key === 'onload-script' ? 'js' : null, via: `${base}: ${raw.trim().slice(0, 160)}` });
      } else {
        const m = base === '.yarnrc' ? /^yarn-path\s+(.+)$/.exec(line) : /^yarnPath:\s*(.+)$/.exec(line);
        if (m) launches.push({ file: unquote(m[1]!.trim()).replace(/\\/g, '/'), lang: 'js', via: `${base}: ${raw.trim().slice(0, 160)}` });
      }
    }
    if (launches.length) launchers.push({ by: f, launches });
  }
  return { launchers, problems };
}

const REPO_ENV_FILES = envFileRuns(REPO.files, readRepo(REPO_ROOT));
const REPO_RC_FILES = rcFileRuns(REPO.files, readRepo(REPO_ROOT));
const REPO_LAUNCHES = evaluateLaunches(
  [...[...REPO.scans].map(([by, s]) => ({ by, launches: s.launches })), ...runbookLaunchers(REPO.files, readRepo(REPO_ROOT)), ...REPO_ENV_FILES.launchers, ...REPO_RC_FILES.launchers],
  readRepo(REPO_ROOT),
  REPO_FILES,
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
    expect(REPO_ENV_FILES.problems).toEqual([]);
    expect(REPO_RC_FILES.problems).toEqual([]);
    // the walk saw launches at all (it cannot pass vacuously): package.json scripts run tsx/node scripts
    expect([...REPO.scans.values()].reduce((n, s) => n + s.launches.length, 0)).toBeGreaterThan(20);
  });

  it('every launch resolves to a repository file or is a reviewed unresolved launch; the list is pinned, justified and not stale (U30F6 F5-3)', () => {
    expect(UNRESOLVED_LAUNCHES.length).toBe(LOCKS.unresolvedLaunches);
    expect(sha256Of({ categories: UNRESOLVED_LAUNCH_CATEGORIES, launches: UNRESOLVED_LAUNCHES })).toBe(LOCKS.unresolvedLaunchesSha256);
    expect(new Set(UNRESOLVED_LAUNCHES.map(unresolvedKey)).size, 'duplicate entries').toBe(UNRESOLVED_LAUNCHES.length);
    for (const text of Object.values(UNRESOLVED_LAUNCH_CATEGORIES)) expect(text.length).toBeGreaterThan(80);
    for (const e of UNRESOLVED_LAUNCHES) expect(e.justification.length, unresolvedKey(e)).toBeGreaterThan(30);
    const actual = new Set(REPO_LAUNCHES.unresolved.map(unresolvedKey));
    expect(UNRESOLVED_LAUNCHES.filter((e) => !actual.has(unresolvedKey(e))).map(unresolvedKey), 'stale: no launch answers these entries any more').toEqual([]);
    expect(REPO_LAUNCHES.unresolved.filter((u) => !UNRESOLVED_REVIEWED.has(unresolvedKey(u))).map(unresolvedKey), 'unresolved launches that are not reviewed').toEqual([]);
    // it cannot pass vacuously: the repository has launches that resolve and launches that do not
    expect(REPO_LAUNCHES.unresolved.length).toBeGreaterThan(20);
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
      // (U30F7: the PowerShell form writes REJECT_RETIRED_DESTRUCTIVE_SCRIPT: <its path> to stderr)
      const m = text.match(/refuseRetiredDestructiveScript\('([^']+)'\)/) ?? (file.endsWith('.ps1') ? text.match(/REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ([A-Za-z0-9_./-]+)/) : null);
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
  // U30F7: the gated PowerShell file of these cases was sanitize-postgis-failed-imports.ps1, now a retired entry point
  ['gated PowerShell file: ogr2ogr -overwrite line', 'scripts/import-gis-arkiv.ps1', '& ogr2ogr -f PostgreSQL "PG:dbname=x" a.gpkg -nln env.sgu_well -overwrite'],
  [
    'gated PowerShell file: gate call swallowed by try/catch, then DROP',
    'scripts/import-gis-arkiv.ps1',
    "try { Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP' -Relation 'env.sgu_well' } catch { }\nInvoke-DbSql \"DROP TABLE IF EXISTS env.sgu_well CASCADE;\" 'x'",
  ],
  ['control: gated PowerShell file: DROP without a gate call', 'scripts/import-gis-arkiv.ps1', "Invoke-DbSql \"DROP TABLE IF EXISTS env.sgu_well CASCADE;\" 'x'"],
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
  const env = envFileRuns(own, read);
  const rc = rcFileRuns(own, read);
  const launchers = [...own.filter((f) => scans.has(f)).map((by) => ({ by, launches: scans.get(by)!.launches })), ...runbookLaunchers(own, read), ...env.launchers, ...rc.launchers];
  out.push(...launchProblems(evaluateLaunches(launchers, read, new Set([...REPO_FILES, ...Object.keys(files)])), ctx), ...env.problems, ...rc.problems);
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

  // U30F6 (F5-1): "$@" is a value; a shell function that only forwards its arguments is read at each in-file call
  it('F5-1 a script that runs "$@" outside a forwarder (the program is a value) -> caught', () => {
    expect(problemsOf('scripts/vrogue/u8a.sh', '#!/bin/sh\n"$@"\n').length).toBeGreaterThan(0);
    expect(problemsOf('scripts/vrogue/u8b.sh', '#!/bin/sh\npsql "$DB" -c "$1"\n').length).toBeGreaterThan(0);
  });

  it('F5-1 a forwarder function: its "$@" line is no channel, and each call is read as the command it forwards (after its shifts)', () => {
    const fwd = 'run_step() {\n  local label="$1"\n  shift\n  echo "$label"\n  "$@"\n}\n';
    expect(problemsOf('scripts/vrogue/u8c.sh', `#!/bin/sh\n${fwd}run_step hello echo ok\n`)).toEqual([]);
    expect(problemsOf('scripts/vrogue/u8d.sh', `#!/bin/sh\n${fwd}run_step wipe "$CMD"\n`).length).toBeGreaterThan(0);
    expect(problemsOfTree({ 'scripts/vrogue/u8e.sh': `#!/bin/sh\n${fwd}run_step wipe bash scripts/vrogue/u8e.txt\n`, 'scripts/vrogue/u8e.txt': 'psql "$DB" -c "TRUNCATE env.sgu_well"\n' }).length).toBeGreaterThan(0);
  });

  it('a PowerShell relation gate still counts -- shown on a drop without CASCADE in a new file (U30F7: its former base, sanitize-postgis-failed-imports.ps1, is retired)', () => {
    const file = 'scripts/vrogue/u7h-relation-gate.ps1';
    const gate = "    Assert-UngovernedWriteAllowed -Caller $gateCaller -Operation 'DROP' -Relation $u\n";
    const text = `. (Join-Path $PSScriptRoot '..\\lib\\ProtectedRelationGate.ps1')\n$gateCaller = '${file}'\nforeach ($u in $args) {\n${gate}    Invoke-DbSql "DROP TABLE IF EXISTS $u;" 'u30f5'\n}\n`;
    expect(problemsOf(file, text)).toEqual([]);
    expect(problemsOf(file, text.replace(gate, '')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F6: the verifier's launch-smuggling cases (U30F5 verification, B01-B26: 23 forms, 3 controls) and the
// forms F5-2 (preloaded modules), F5-3 (unresolved launches), F5-4 (dynamic launch paths), F5-6 (templates),
// F5-7 (folded YAML), F5-10 (revoke on the literal surface)
// ---------------------------------------------------------------------------------------------

const EVIL6_SQL = 'TRUNCATE env.sgu_well';
const EVIL6_TS = `${PG5}await pool.query('${EVIL6_SQL}');\n`;
const EVIL6_SH = `psql "$DB" -c "${EVIL6_SQL}"\n`;
const EVIL6_PY = `import psycopg2\npsycopg2.connect('').cursor().execute('${EVIL6_SQL}')\n`;
const npm6 = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) => `${JSON.stringify({ name: 'x', ...extra, scripts }, null, 2)}\n`;

/**
 * The verifier's B cases as written (v-attack.test.ts, U30F5 verification). `caught`: a violation the scan must
 * catch; `control`: must pass; `B3`/`B7`: a KNOWN LIMIT the report lists under that blocker (unknown package code,
 * runbook SQL) -- pinned as not caught here, so a change either way is a reviewed edit of this table.
 */
const SMUGGLING_CASES: readonly { id: string; expect: 'caught' | 'control' | 'B3' | 'B7'; files: Record<string, string> }[] = [
  { id: 'B01 npm "tsx ./rel/unit/x.test.ts" (test source outside runner)', expect: 'caught', files: { 'tools/b01/package.json': npm6({ x: 'tsx ./scripts/brogue/unit/purge1.test.ts' }), 'scripts/brogue/unit/purge1.test.ts': EVIL6_TS } },
  { id: 'B02 npm "npx tsx" test source', expect: 'caught', files: { 'tools/b02/package.json': npm6({ x: 'npx tsx scripts/brogue/unit/purge2.test.ts' }), 'scripts/brogue/unit/purge2.test.ts': EVIL6_TS } },
  { id: 'B03 npm "pnpm exec tsx" test source', expect: 'caught', files: { 'tools/b03/package.json': npm6({ x: 'pnpm exec tsx scripts/brogue/unit/purge3.test.ts' }), 'scripts/brogue/unit/purge3.test.ts': EVIL6_TS } },
  { id: 'B04 npm "node --require ./x.txt" (required file is code)', expect: 'caught', files: { 'tools/b04/package.json': npm6({ x: 'node --require ./scripts/brogue/hook4.txt scripts/brogue/ok4.mjs' }), 'scripts/brogue/hook4.txt': `require('child_process').execSync('psql -c "${EVIL6_SQL}"');\n`, 'scripts/brogue/ok4.mjs': 'console.log(1);\n' } },
  { id: 'B05 npm "node --import ./hook.mjs" with a DATA-named hook', expect: 'caught', files: { 'tools/b05/package.json': npm6({ x: 'node --import ./scripts/brogue/hook5.json scripts/brogue/ok5.mjs' }), 'scripts/brogue/hook5.json': EVIL6_TS, 'scripts/brogue/ok5.mjs': 'console.log(1);\n' } },
  { id: 'B06 npm "yarn dlx <unknown package>"', expect: 'B3', files: { 'tools/b06/package.json': npm6({ x: 'yarn dlx pg-wipe-everything --schema env' }) } },
  { id: 'B07 CI step "bash scripts/x.txt"', expect: 'caught', files: { '.github/workflows/b07.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash scripts/brogue/purge7.txt\n', 'scripts/brogue/purge7.txt': EVIL6_SH } },
  { id: 'B08 Dockerfile COPY data file + ENTRYPOINT sh /container/path', expect: 'caught', files: { 'deploy/b08/Dockerfile': 'FROM postgres:16\nCOPY scripts/brogue/purge8.txt /x.sh\nENTRYPOINT ["sh", "/x.sh"]\n', 'scripts/brogue/purge8.txt': EVIL6_SH } },
  { id: 'B09 compose command bash /app/<abs container path>', expect: 'caught', files: { 'deploy/b09/docker-compose.yml': 'services:\n  m:\n    image: x\n    command: ["bash", "/app/scripts/brogue/purge9.txt"]\n', 'scripts/brogue/purge9.txt': EVIL6_SH } },
  { id: 'B10 compose command bash relative path', expect: 'caught', files: { 'deploy/b10/docker-compose.yml': 'services:\n  m:\n    image: x\n    command: bash scripts/brogue/purge10.txt\n', 'scripts/brogue/purge10.txt': EVIL6_SH } },
  { id: 'B11 .devcontainer postCreateCommand bash data file', expect: 'caught', files: { '.devcontainer/b11/devcontainer.json': `${JSON.stringify({ postCreateCommand: 'bash scripts/brogue/purge11.txt' })}\n`, 'scripts/brogue/purge11.txt': EVIL6_SH } },
  // (U30F9 G8-7: a `bin` file is a launch node runs -- caught now; it was pinned as B3 before)
  { id: 'B12 package.json "bin" entry to a data file', expect: 'caught', files: { 'tools/b12/package.json': npm6({ ok: 'echo ok' }, { bin: { wipe: 'scripts/brogue/purge12.txt' } }), 'scripts/brogue/purge12.txt': `#!/usr/bin/env node\n${EVIL6_TS}` } },
  { id: 'B13 sh chain bash "$(dirname "$0")/x.txt" (dynamic path)', expect: 'caught', files: { 'scripts/brogue/run13.sh': '#!/bin/sh\nbash "$(dirname "$0")/purge13.txt"\n', 'scripts/brogue/purge13.txt': EVIL6_SH } },
  { id: 'B14 python chain subprocess python x.md', expect: 'caught', files: { 'scripts/brogue/run14.py': "import subprocess\nsubprocess.run(['python', 'scripts/brogue/purge14.md'])\n", 'scripts/brogue/purge14.md': EVIL6_PY } },
  { id: 'B15 ps1 chain & pwsh -File (Join-Path $PSScriptRoot x.txt)', expect: 'caught', files: { 'scripts/brogue/run15.ps1': "& pwsh -File (Join-Path $PSScriptRoot 'purge15.txt')\n", 'scripts/brogue/purge15.txt': `psql -c "${EVIL6_SQL}"\n` } },
  { id: 'B16 npm direct exec of an extensionless file', expect: 'caught', files: { 'tools/b16/package.json': npm6({ x: './scripts/brogue/purge16' }), 'scripts/brogue/purge16': `#!/bin/sh\n${EVIL6_SH}` } },
  { id: 'B17 npm bash of a .json (wrong extension)', expect: 'caught', files: { 'tools/b17/package.json': npm6({ x: 'bash scripts/brogue/purge17.json' }), 'scripts/brogue/purge17.json': EVIL6_SH } },
  { id: 'B18 runbook ```bash block runs a data file', expect: 'caught', files: { 'docs/brogue/runbook18.md': '# ops\n\n```bash\nbash scripts/brogue/purge18.txt\n```\n', 'scripts/brogue/purge18.txt': EVIL6_SH } },
  { id: 'B19 runbook ```bash block with inline psql TRUNCATE', expect: 'B7', files: { 'docs/brogue/runbook19.md': `# ops\n\n\`\`\`bash\n${EVIL6_SH}\`\`\`\n` } },
  { id: 'B20 tsx with a flag value then a test source', expect: 'caught', files: { 'tools/b20/package.json': npm6({ x: 'tsx --tsconfig tsconfig.json scripts/brogue/unit/purge20.test.ts' }), 'scripts/brogue/unit/purge20.test.ts': EVIL6_TS } },
  { id: 'B21 control: a DATA file with SQL that nothing launches', expect: 'control', files: { 'scripts/brogue/notes21.txt': EVIL6_SH } },
  { id: 'B22 control: a test source that only its runner runs', expect: 'control', files: { 'scripts/brogue/unit/only-runner22.test.ts': EVIL6_TS } },
  { id: 'B23 control: npm script runs vitest on a test source (runner)', expect: 'control', files: { 'tools/b23/package.json': npm6({ t: 'vitest run scripts/brogue/unit/purge23.test.ts' }), 'scripts/brogue/unit/purge23.test.ts': EVIL6_TS } },
  { id: 'B24 npm "node -r ts-node/register x.test.ts"', expect: 'caught', files: { 'tools/b24/package.json': npm6({ x: 'node -r ts-node/register scripts/brogue/unit/purge24.test.ts' }), 'scripts/brogue/unit/purge24.test.ts': EVIL6_TS } },
  { id: 'B25 npm "sh -c \'bash scripts/x.txt\'"', expect: 'caught', files: { 'tools/b25/package.json': npm6({ x: "sh -c 'bash scripts/brogue/purge25.txt'" }), 'scripts/brogue/purge25.txt': EVIL6_SH } },
  { id: 'B26 npm "source scripts/x.txt" via bash -c', expect: 'caught', files: { 'tools/b26/package.json': npm6({ x: "bash -c '. scripts/brogue/purge26.txt'" }), 'scripts/brogue/purge26.txt': EVIL6_SH } },
  // the verifier's A forms this unit closes (A21, A30: F5-1/F5-5 in the gate; A41: F5-6)
  { id: 'A21 psql -c "$1" (positional)', expect: 'caught', files: { 'scripts/arogue/a21.sh': '#!/bin/sh\npsql "$DB" -c "$1"\n' } },
  { id: 'A30 pgbench -f custom SQL script', expect: 'caught', files: { 'scripts/arogue/a30.sh': '#!/bin/sh\npgbench -n -f /tmp/wipe.sql -t 1 "$DB"\n' } },
  { id: 'A41 Taskfile.yml cmds: psql -c templated SQL', expect: 'caught', files: { 'tools/arogue2/Taskfile.yml': "version: '3'\ntasks:\n  wipe:\n    cmds:\n      - psql -c \"{{.SQL}}\"\n" } },
];

describe("canaries: U30F6 -- the verifier's launch-smuggling cases B01-B26 and A21/A30/A41", () => {
  it('the table holds the 23 smuggling forms and 3 controls of B01-B26 (B12 caught since U30F9; B06 and B19 stay pinned limits)', () => {
    const b = SMUGGLING_CASES.filter((c) => c.id.startsWith('B'));
    expect(b.length).toBe(26);
    expect(b.filter((c) => c.expect === 'control').length).toBe(3);
    expect(b.filter((c) => c.expect === 'B3' || c.expect === 'B7').map((c) => c.id.slice(0, 3))).toEqual(['B06', 'B19']);
  });

  it.each(SMUGGLING_CASES.filter((c) => c.expect === 'caught').map((c) => [c.id, c] as const))('%s -> caught', (_id, c) => {
    expect(problemsOfTree(c.files).length, `MISSED: ${c.id}`).toBeGreaterThan(0);
  });

  it.each(SMUGGLING_CASES.filter((c) => c.expect === 'control').map((c) => [c.id, c] as const))('%s passes', (_id, c) => {
    expect(problemsOfTree(c.files)).toEqual([]);
  });

  it.each(SMUGGLING_CASES.filter((c) => c.expect === 'B3' || c.expect === 'B7').map((c) => [c.id, c] as const))('KNOWN LIMIT (pinned, BLOCKERARE B3/B7 in the report): %s is not caught by this scan', (_id, c) => {
    expect(problemsOfTree(c.files)).toEqual([]);
  });
});

describe('canaries: U30F6 -- F5-2 preloaded modules, F5-3 unresolved launches, F5-4 dynamic launch paths', () => {
  const HOOK_TXT = `require('child_process').execSync('psql -c "${EVIL6_SQL}"');\n`;
  it.each([
    ['F5-2 npm: node -r ./hook.txt (short form)', { 'tools/u9a/package.json': npm6({ x: 'node -r ./scripts/w6rogue/hook-a.txt scripts/w6rogue/ok-a.mjs' }), 'scripts/w6rogue/hook-a.txt': HOOK_TXT, 'scripts/w6rogue/ok-a.mjs': 'console.log(1);\n' }],
    ['F5-2 npm: node --loader ./hook.txt', { 'tools/u9b/package.json': npm6({ x: 'node --loader ./scripts/w6rogue/hook-b.txt scripts/w6rogue/ok-b.mjs' }), 'scripts/w6rogue/hook-b.txt': HOOK_TXT, 'scripts/w6rogue/ok-b.mjs': 'console.log(1);\n' }],
    ['F5-2 npm: node --experimental-loader=./hook.txt (= form)', { 'tools/u9c/package.json': npm6({ x: 'node --experimental-loader=./scripts/w6rogue/hook-c.txt scripts/w6rogue/ok-c.mjs' }), 'scripts/w6rogue/hook-c.txt': HOOK_TXT, 'scripts/w6rogue/ok-c.mjs': 'console.log(1);\n' }],
    ['F5-2 npm: tsx --import ./hook.json', { 'tools/u9d/package.json': npm6({ x: 'tsx --import ./scripts/w6rogue/hook-d.json scripts/w6rogue/ok-d.ts' }), 'scripts/w6rogue/hook-d.json': EVIL6_TS, 'scripts/w6rogue/ok-d.ts': 'console.log(1);\n' }],
    ['F5-2 CI: node --require=./hook.txt (= form)', { '.github/workflows/u9e.yml': ci('      - run: node --require=./scripts/w6rogue/hook-e.txt scripts/w6rogue/ok-e.mjs\n'), 'scripts/w6rogue/hook-e.txt': HOOK_TXT, 'scripts/w6rogue/ok-e.mjs': 'console.log(1);\n' }],
    ['F5-3 npm: bash of a repository path that does not exist', { 'tools/u9f/package.json': npm6({ x: 'bash scripts/w6rogue/no-such-file.sh' }) }],
    ['F5-3 CI: python -m of a module that is not in the repository', { '.github/workflows/u9g.yml': ci('      - run: python -m w6rogue_no_such_module --wipe\n') }],
    ['F5-3 Dockerfile: CMD runs a container path no COPY in the repository explains', { 'deploy/u9h/Dockerfile': 'FROM node:22\nCMD ["node", "/srv/w6rogue/wipe.js"]\n' }],
    ['F5-4 sh: bash "$DIR/x.sh" with DIR not in the source', { 'scripts/w6rogue/f4a.sh': '#!/bin/sh\nbash "$DIR/wipe.sh"\n' }],
    ['F5-4 npm: node "$SCRIPTS/x.js"', { 'tools/u9i/package.json': npm6({ x: 'node "$SCRIPTS/wipe.js"' }) }],
    ['F5-4 ps1: pwsh -File "$env:TOOLS\\x.ps1"', { 'scripts/w6rogue/f4b.ps1': '& pwsh -File "$env:TOOLS\\wipe.ps1"\n' }],
    ['F5-4 sh: a file executed directly at a dynamic directory', { 'scripts/w6rogue/f4c.sh': '#!/bin/sh\n"$TOOLS/wipe.sh" --all\n' }],
    ['F5-4 npm: node -r with a dynamic preload', { 'tools/u9j/package.json': npm6({ x: 'node -r "$HOOK" scripts/w6rogue/ok-j.mjs' }), 'scripts/w6rogue/ok-j.mjs': 'console.log(1);\n' }],
    ['F5-4 sh: SCRIPT_DIR from dirname "$0" then bash "$SCRIPT_DIR/x.txt" (resolved, scanned as sh)', { 'scripts/w6rogue/f4d.sh': '#!/bin/sh\nSCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\nbash "$SCRIPT_DIR/f4d-purge.txt"\n', 'scripts/w6rogue/f4d-purge.txt': EVIL6_SH }],
    ['F5-4 cmd: call "%~dp0x.txt" (resolved: a data file executed directly)', { 'scripts/w6rogue/f4e.cmd': '@echo off\r\ncall "%~dp0f4e-purge.txt"\r\n', 'scripts/w6rogue/f4e-purge.txt': EVIL6_SH }],
    // owner decision 2026-10-03: an unknown executable entry is no safe entry -- a package preload is reviewed or fails
    ['F5-2/F5-3 npm: node -r of a package (dotenv/config) that no reviewed entry names, before a harmless script', { 'tools/u9k/package.json': npm6({ x: 'node -r dotenv/config scripts/w6rogue/ok-k.mjs' }), 'scripts/w6rogue/ok-k.mjs': 'console.log(1);\n' }],
    ['F5-2/F5-3 npm: node --import tsx from a new launcher (the reviewed tsx preloads are per launcher)', { 'tools/u9s/package.json': npm6({ x: 'node --import tsx scripts/w6rogue/ok-s.ts' }), 'scripts/w6rogue/ok-s.ts': 'console.log(1);\n' }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfTree(files).length).toBeGreaterThan(0);
  });

  it.each([
    ['F5-2 npm: node --import ./hook.mjs that writes nothing', { 'tools/u9l/package.json': npm6({ x: 'node --import ./scripts/w6rogue/hook-l.mjs scripts/w6rogue/ok-l.mjs' }), 'scripts/w6rogue/hook-l.mjs': 'console.log(0);\n', 'scripts/w6rogue/ok-l.mjs': 'console.log(1);\n' }],
    ['F5-4 sh: bash "$(dirname "$0")/ok.sh" that runs no DB tool', { 'scripts/w6rogue/f4f.sh': '#!/bin/sh\nbash "$(dirname "$0")/f4f-ok.sh"\n', 'scripts/w6rogue/f4f-ok.sh': 'echo ok\n' }],
    ['F5-4 ps1: & pwsh -File (Join-Path $PSScriptRoot ok.ps1) that runs no DB tool', { 'scripts/w6rogue/f4g.ps1': "& pwsh -File (Join-Path $PSScriptRoot 'f4g-ok.ps1')\n", 'scripts/w6rogue/f4g-ok.ps1': "Write-Host 'ok'\n" }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfTree(files)).toEqual([]);
  });
});

describe('canaries: U30F6 -- F5-6 template placeholders, F5-7 folded YAML blocks, F5-10 revoke and find', () => {
  it.each([
    ['F5-6 Taskfile: psql -c "{{ .SQL }}" (spaced)', { 'tools/u9m/Taskfile.yml': "version: '3'\ntasks:\n  wipe:\n    cmds:\n      - psql -c \"{{ .SQL }}\"\n" }],
    ['F5-6 Taskfile: bash -c "{{.CMD}}"', { 'tools/u9n/Taskfile.yml': "version: '3'\ntasks:\n  wipe:\n    cmds:\n      - bash -c \"{{.CMD}}\"\n" }],
    ['F5-7 CI run: > with node on one line and -e on the next', { '.github/workflows/u9o.yml': ci('      - run: >\n          node\n          -e "require(\'child_process\').execSync(process.env.X)"\n') }],
    ['F5-7 CI run: >- with python on one line and -c on the next', { '.github/workflows/u9p.yml': ci(`      - run: >-\n          python\n          -c "import psycopg2; psycopg2.connect('').cursor().execute('${EVIL6_SQL}')"\n`) }],
    ['F5-10 a literal holding only REVOKE ... ON a protected relation', { 'scripts/w6rogue/f10a.ts': "export const q = 'REVOKE ALL ON env.sgu_well FROM app_user';\n" }],
    ['F5-10 sh: find -exec psql -c {} + (only the runner rule reads it)', { 'scripts/w6rogue/f10b.sh': "#!/bin/sh\nfind . -name '*.sql' -exec psql -c {} +\n" }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfTree(files).length).toBeGreaterThan(0);
  });

  it.each([
    ['F5-6 Taskfile: echo "{{.NAME}}" runs no DB tool', { 'tools/u9q/Taskfile.yml': "version: '3'\ntasks:\n  hello:\n    cmds:\n      - echo \"{{.NAME}}\"\n" }],
    ['F5-7 CI run: > folding npx vitest run and a test source on the next line (its runner: no launch)', { '.github/workflows/u9r.yml': ci('      - run: >\n          npx vitest run\n          scripts/w6rogue/unit/purge-r.test.ts\n'), 'scripts/w6rogue/unit/purge-r.test.ts': EVIL6_TS }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfTree(files)).toEqual([]);
  });
});

describe('canaries: U30F6 mutation round 1 -- what the first canaries left unexercised', () => {
  it.each([
    ['F5-4 CI: python -m "$MOD" (a module the source does not hold)', { '.github/workflows/u9y.yml': ci('      - run: python -m "$MOD" --all\n') }],
    ['F5-7 CI run: > -- a more-indented line keeps its line break (psql is its own command)', { '.github/workflows/u9z.yml': ci('      - run: >\n          echo start\n            psql "$DB" -c "$SQL"\n') }],
    ['F5-7 CI run: > -- two more-indented lines stay two commands (bash runs the data file)', { '.github/workflows/u9z2.yml': ci('      - run: >\n          echo start\n            echo safe\n            bash scripts/w6rogue/fold-z2.txt\n'), 'scripts/w6rogue/fold-z2.txt': EVIL6_SH }],
    ['F5-3 npm: node runs a package file by path (node_modules/...): unknown package code, not reviewed', { 'tools/u9t/package.json': npm6({ x: 'node node_modules/pg-wipe/bin/cli.js --all' }) }],
    ['F5-2/F5-3 npm: a package preload is the package even when a harmless file of that name sits beside the launcher', { 'tools/u9u/package.json': npm6({ x: 'node --import wipe-pkg scripts/w6rogue/ok-u.mjs' }), 'tools/u9u/wipe-pkg': 'console.log(0);\n', 'scripts/w6rogue/ok-u.mjs': 'console.log(1);\n' }],
    ['deno run -r <file>: -r is --reload (no value), the file is the script', { 'tools/u9v/package.json': npm6({ x: 'deno run -r scripts/w6rogue/deno-v.txt' }), 'scripts/w6rogue/deno-v.txt': EVIL6_TS }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfTree(files).length).toBeGreaterThan(0);
  });

  it.each([
    // the launcher's directory is read precisely: a same-named data file elsewhere is not the one run
    ['F5-4 sh: bash "$(dirname "$0")/same.txt" runs the launcher\'s own same.txt, not another directory\'s', { 'scripts/w6rogue/pa/run-a.sh': '#!/bin/sh\nbash "$(dirname "$0")/same.txt"\n', 'scripts/w6rogue/pa/same.txt': 'echo ok\n', 'scripts/w6rogue/pb/same.txt': EVIL6_SH }],
    ['F5-4 sh: SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" then bash "$SCRIPT_DIR/same-c.txt" (the variable is the launcher\'s directory)', { 'scripts/w6rogue/pc/run-c.sh': '#!/bin/sh\nSCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"\nbash "$SCRIPT_DIR/same-c.txt"\n', 'scripts/w6rogue/pc/same-c.txt': 'echo ok\n', 'scripts/w6rogue/pd/same-c.txt': EVIL6_SH }],
    ['F5-4 ps1: & pwsh -File (Join-Path $PSScriptRoot same-e.txt) runs the launcher\'s own file', { 'scripts/w6rogue/pe/run-e.ps1': "& pwsh -File (Join-Path $PSScriptRoot 'same-e.txt')\n", 'scripts/w6rogue/pe/same-e.txt': "Write-Host 'ok'\n", 'scripts/w6rogue/pf/same-e.txt': `psql -c "${EVIL6_SQL}"\n` }],
    ['F5-4 cmd: call "%~dp0same-g.bat" resolves beside the launcher (not DYNAMIC)', { 'scripts/w6rogue/pg/run-g.cmd': '@echo off\r\ncall "%~dp0same-g.bat"\r\n', 'scripts/w6rogue/pg/same-g.bat': '@echo off\r\necho ok\r\n' }],
    ['sh: bash -s reads its script from stdin; the path after it is an argument, not a script', { 'scripts/w6rogue/s-run.sh': "#!/bin/sh\necho 'echo hi' | bash -s scripts/w6rogue/s-notes.txt\n", 'scripts/w6rogue/s-notes.txt': EVIL6_SH }],
    ['F5-3 CI: python -m of a repository package runs its __main__.py (resolved, scanned as Python)', { '.github/workflows/u9w.yml': ci('      - run: python -m scripts.w6rogue.pkgok\n'), 'scripts/w6rogue/pkgok/__main__.py': "print('ok')\n" }],
    ['F5-2 vite-node -r <root>: -r is --root there, not a preload', { 'tools/u9x/package.json': npm6({ x: 'vite-node -r scripts/w6rogue scripts/w6rogue/ok-x.ts' }), 'scripts/w6rogue/ok-x.ts': 'console.log(1);\n' }],
    ['F5-2 deno run -r <file>: no preload, the file is the script (harmless here)', { 'tools/u9q2/package.json': npm6({ x: 'deno run -r scripts/w6rogue/ok-q.ts' }), 'scripts/w6rogue/ok-q.ts': 'console.log(1);\n' }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfTree(files)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F7 (owner decision 2026-10-03): the three CASCADE scripts of BLOCKERARE D-7 -- two retired entry points that are
// nothing but their refusal, one gated without CASCADE
// ---------------------------------------------------------------------------------------------

const U30F7_RETIRED = ['scripts/db/cleanup-db.ts', 'scripts/import/sanitize-postgis-failed-imports.ps1'] as const;
const U30F7_GATED = 'scripts/import/fill-empty-gaps-from-archive.ts';

/** The code of a script without its comments (TS: line and block comments; PowerShell: # and block comments). */
function codeOf(file: string, text: string): string {
  return file.endsWith('.ps1') ? text.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '') : text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('U30F7: the CASCADE scripts are retired entry points or gated (owner decision 2026-10-03)', () => {
  it.each(U30F7_RETIRED)('%s is a retired entry point: listed, refused before anything, nothing but its refusal (content pinned), no DROP and no CASCADE left', (file) => {
    expect(RETIRED_DESTRUCTIVE_SCRIPTS.some((r) => r.script === file), `${file} in RETIRED_DESTRUCTIVE_SCRIPTS`).toBe(true);
    const text = realText(file);
    expect(retiredRefusesFirst(file, text)).toBeNull();
    expect(RETIRED_ENTRYPOINT_ONLY[file], `${file}: its content is pinned`).toBe(normalisedSha(text));
    expect(codeOf(file, text)).not.toMatch(/\b(CASCADE|DROP)\b/i);
  });

  it('fill-empty-gaps-from-archive.ts holds no CASCADE, and each of its two DROPs is inside gatedSql, the gate of its other protected-relation operations', () => {
    const code = codeOf(U30F7_GATED, realText(U30F7_GATED));
    expect(code).not.toMatch(/\bCASCADE\b/i);
    const drops = [...code.matchAll(/DROP TABLE/gi)].map((m) => m.index!);
    expect(drops.length).toBe(2);
    for (const at of drops) expect(code.slice(Math.max(0, at - 90), at)).toMatch(/gatedSql\(\s*'scripts\/import\/fill-empty-gaps-from-archive\.ts',\s*[`']$/);
  });

  it.each([
    ['scripts/db/cleanup-db.ts', "\nconst p2 = new PrismaClient();\nawait p2.$executeRawUnsafe('DROP TABLE IF EXISTS public.u30f7 CASCADE');\n"],
    ['scripts/import/sanitize-postgis-failed-imports.ps1', "\ndocker exec miljobeslut-postgres psql -c 'DROP TABLE IF EXISTS public.u30f7 CASCADE;'\n"],
    ['scripts/import/fill-empty-gaps-from-archive.ts', "\npsql('DROP TABLE IF EXISTS env.u30f7 CASCADE;', 'drop env.u30f7');\n"],
  ] as const)('a NEW CASCADE site in %s still fails', (file, append) => {
    expect(problemsOf(file, `${realText(file)}${append}`).length).toBeGreaterThan(0);
  });

  // U30F7 mutation round 1: the PowerShell refusal form itself, on a retired script that is not content-pinned
  it('a retired PowerShell script must refuse first and exit non-zero: exit 0, or a statement before the refusal, fails; the proper form passes', () => {
    const file = 'scripts/vrogue/u7r.ps1';
    const retired = [...RETIRED_DESTRUCTIVE_SCRIPTS.map((r) => r.script), file];
    const refusal = `[Console]::Error.WriteLine('REJECT_RETIRED_DESTRUCTIVE_SCRIPT: ${file} -- retired')\n`;
    const why = 'retired PowerShell without its refusal first (REJECT_RETIRED_DESTRUCTIVE_SCRIPT to stderr, then exit non-zero)';
    expect(problemsOf(file, `# retired\n${refusal}exit 2\n`, { retired })).toEqual([]);
    expect(problemsOf(file, `# retired\n${refusal}exit 0\n`, { retired }).map((p) => p.problem)).toEqual([why]);
    expect(problemsOf(file, `Write-Host 'first'\n${refusal}exit 2\n`, { retired }).map((p) => p.problem)).toEqual([why]);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F8: the delta verifier's G6-1..G6-11 (U30F6+F7 verification) -- here-documents, content-pinned DYNAMIC entries,
// JSON-config preloads, PowerShell dot-sourcing, NODE_OPTIONS, npm/yarn run of a value, a new unresolved launch of a
// reviewed launcher
// ---------------------------------------------------------------------------------------------

/** As problemsOfTree, but a file may also REPLACE an existing repository file (an edit of a real file, in memory). */
function problemsOfChange(files: Readonly<Record<string, string>>): Problem[] {
  const realRead = readRepo(REPO_ROOT);
  const read = (p: string): string | null => (Object.prototype.hasOwnProperty.call(files, p) ? files[p]! : realRead(p));
  const texts = new Map(REPO.texts);
  const scans = new Map(REPO.scans);
  for (const [f, text] of Object.entries(files)) {
    texts.set(f, text);
    if (isScannedPath(f)) scans.set(f, scanFile(f, text, { readRepoFile: read }));
  }
  const overlay: RepositoryScan = { files: [...new Set([...REPO.files, ...Object.keys(files)])].sort(), scans, texts };
  const ctx = contextFor(overlay);
  const out: Problem[] = [];
  for (const f of Object.keys(files)) {
    const scan = scans.get(f);
    if (scan) out.push(...evaluateFile(f, texts.get(f)!, scan, ctx));
  }
  const own = Object.keys(files);
  const env = envFileRuns(own, read);
  const rc = rcFileRuns(own, read);
  const launchers = [...own.filter((f) => scans.has(f)).map((by) => ({ by, launches: scans.get(by)!.launches })), ...runbookLaunchers(own, read), ...env.launchers, ...rc.launchers];
  out.push(...launchProblems(evaluateLaunches(launchers, read, new Set([...REPO_FILES, ...Object.keys(files)])), ctx), ...env.problems, ...rc.problems);
  return out.filter((p) => !p.open);
}

const EVIL8_SQL = 'TRUNCATE env.sgu_well';
const EVIL8_SH = `psql "$DB" -c "${EVIL8_SQL}"\n`;
const EVIL8_CJS = `require('child_process').execSync('psql -c "${EVIL8_SQL}"');\n`;
const EVIL8_TS = `${PG5}await pool.query('${EVIL8_SQL}');\n`;
const EVIL8_PY = `import psycopg2\npsycopg2.connect('').cursor().execute('${EVIL8_SQL}')\n`;
const OK8 = 'console.log(1);\n';
const sh8 = (body: string) => `#!/bin/sh\n${body}\n`;

describe('canaries: U30F8 -- G6-1 here-documents, here-strings and stdin carry values or code into a program', () => {
  it.each([
    ['P20 sh: psql "$DB" <<EOF with $1', { 'scripts/w8rogue/p20.sh': '#!/bin/sh\npsql "$DB" <<EOF\n$1\nEOF\n' }],
    ['E7 sh: psql "$DB" <<EOF with $SQL', { 'scripts/w8rogue/e7.sh': '#!/bin/sh\npsql "$DB" <<EOF\n$SQL\nEOF\n' }],
    ['sh: psql <<-EOF (tab-stripped) with "$@"', { 'scripts/w8rogue/g1a.sh': '#!/bin/sh\npsql <<-EOF\n\t$@\n\tEOF\n' }],
    ['sh: psql <<< "$SQL" (here-string)', { 'scripts/w8rogue/g1b.sh': sh8('psql "$DB" <<< "$SQL"') }],
    ['sh: docker exec -i db psql <<EOF with $1', { 'scripts/w8rogue/g1c.sh': '#!/bin/sh\ndocker exec -i db psql -U u <<EOF\n$1\nEOF\n' }],
    ['sh: bash <<EOF running $CMD', { 'scripts/w8rogue/g1d.sh': '#!/bin/sh\nbash <<EOF\n$CMD\nEOF\n' }],
    ['sh: docker exec -i db sh <<EOF running $CMD', { 'scripts/w8rogue/g1e.sh': '#!/bin/sh\ndocker exec -i db sh <<EOF\n$CMD\nEOF\n' }],
    ['sh: python3 - <<EOF with $CODE', { 'scripts/w8rogue/g1f.sh': '#!/bin/sh\npython3 - <<EOF\n$CODE\nEOF\n' }],
    ['sh: node <<< "$JS"', { 'scripts/w8rogue/g1g.sh': sh8('node <<< "$JS"') }],
    ["sh: python3 - <<'PY' whose (unexpanded) body executes SQL from the environment", { 'scripts/w8rogue/g1h.sh': "#!/bin/sh\npython3 - <<'PY'\nimport os, psycopg2\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\nPY\n" }],
    ['sh: bash < data file (stdin script)', { 'scripts/w8rogue/g1i.sh': sh8('bash < scripts/w8rogue/g1i.txt'), 'scripts/w8rogue/g1i.txt': EVIL8_SH }],
    ['CI run: | with psql <<EOF and ${{ inputs.sql }}', { '.github/workflows/w8g1j.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          psql "$DB" <<EOF\n          $SQL\n          EOF\n' }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfTree(files).length).toBeGreaterThan(0);
  });

  it.each([
    // (U30F9 default-deny: the connection `"$DB"` these two controls had is a value in a psql command and fails now -- see the
    // U30F9 canaries; the here-document rule itself is shown with a literal connection)
    ["E11 sh: psql <<'EOF' with a static SELECT (quoted: no expansion)", { 'scripts/w8rogue/c1.sh': "#!/bin/sh\npsql postgresql://localhost/x <<'EOF'\nSELECT 1;\nEOF\n" }],
    ["sh: psql <<'EOF' with a bind parameter $1 (quoted: no expansion)", { 'scripts/w8rogue/c2.sh': "#!/bin/sh\npsql postgresql://localhost/x <<'EOF'\nDELETE FROM stage.x WHERE id = $1;\nEOF\n" }],
    ['sh: cat <<EOF > file with $HOME (data, not code)', { 'scripts/w8rogue/c3.sh': '#!/bin/sh\ncat <<EOF > out.txt\nhome=$HOME\nEOF\n' }],
    ["sh: python3 - <<'PY' that prints", { 'scripts/w8rogue/c4.sh': "#!/bin/sh\npython3 - <<'PY'\nprint(1)\nPY\n" }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfTree(files)).toEqual([]);
  });
});

const ORCH8 = 'scripts/import/run-geodata-gap-pipeline.ts';
const LMSTAC8 = 'scripts/import/run-lm-stac-librarian-pipeline.ts';
const NAT8 = 'scripts/import/run-national-reharvest.ts';
const SGUP8 = 'scripts/import/run-sgu-librarian-pipeline.ts';
const FOCUS8 = 'scripts/import/run-import-focus.ps1';

describe('canaries: U30F8 -- G6-2 a reviewed DYNAMIC file is pinned by content: a new call path in it fails until it is reviewed again', () => {
  it.each([
    ['O1 orchestrator: a new runTsx of a test source', { [ORCH8]: `${realText(ORCH8)}\nrunTsx('evil', 'scripts/w8o/unit/o1.test.ts');\n`, 'scripts/w8o/unit/o1.test.ts': EVIL8_TS }],
    ['O2 orchestrator: a new runTsx of process.argv[2]', { [ORCH8]: `${realText(ORCH8)}\nrunTsx('evil', process.argv[2]!);\n` }],
    ['O3 orchestrator: a new runTsx of a data file', { [ORCH8]: `${realText(ORCH8)}\nrunTsx('evil', 'scripts/w8o/o3.txt');\n`, 'scripts/w8o/o3.txt': EVIL8_TS }],
    ['O4 lm-stac orchestrator: a new run of process.argv[3]', { [LMSTAC8]: `${realText(LMSTAC8)}\nrun('evil', [process.argv[3]!]);\n` }],
    ['O5 national orchestrator: a new runPy of a data file', { [NAT8]: `${realText(NAT8)}\nrunPy('evil', 'scripts/w8o/o5.txt', 'x');\n`, 'scripts/w8o/o5.txt': EVIL8_PY }],
    ['E8 run-sgu orchestrator: a new run of a test source', { [SGUP8]: `${realText(SGUP8)}\nrun('evil', ['scripts/w8o/unit/e8.test.ts']);\n`, 'scripts/w8o/unit/e8.test.ts': EVIL8_TS }],
    ['E9 run-import-focus.ps1: a new Run-Step of a data file', { [FOCUS8]: `${realText(FOCUS8)}\nRun-Step 'evil' 'bash scripts/w8o/p9.txt'\n`, 'scripts/w8o/p9.txt': EVIL8_SH }],
    ['a reviewed DYNAMIC file with only a comment changed (any change is a re-review)', { [ORCH8]: `${realText(ORCH8)}\n// u30f8\n` }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfChange(files).length).toBeGreaterThan(0);
  });

  it('every DYNAMIC_REVIEWED entry carries a content pin (sha256 of what the scan reads of the file)', () => {
    const dynamicEntries = REVIEWED_CHANNELS.filter((e) => e.policy === 'DYNAMIC_REVIEWED');
    expect(dynamicEntries.length).toBeGreaterThan(40);
    for (const e of dynamicEntries) expect((e as { contentSha256?: string }).contentSha256, e.file).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canaries: U30F8 -- G6-11 a new unresolved launch in a launcher that already has reviewed ones still fails as unresolved', () => {
  it.each([
    ['O6 package.json: a new npm script to a missing file', '"xo6": "tsx scripts/w8o/missing-o6.ts",'],
    ['O7 package.json: a new package preload', '"xo7": "node -r dotenv/config scripts/import/run-geodata-gap-pipeline.ts",'],
  ] as const)('%s', (_label, line) => {
    const pkg8 = realText('package.json').replace('"scripts": {', `"scripts": {\n    ${line}`);
    const problems = problemsOfChange({ 'package.json': pkg8 });
    expect(problems.some((p) => /resolves to no repository file and is not a reviewed unresolved launch/.test(p.problem)), JSON.stringify(problems).slice(0, 600)).toBe(true);
  });
});

describe('canaries: U30F8 -- G6-3 JSON configurations, G6-4 PowerShell dot-sourcing, G6-5 NODE_OPTIONS, G6-6 run of a value', () => {
  it.each([
    ['L20 devcontainer: node --import ./h.json', { '.devcontainer/w8l20/devcontainer.json': `${JSON.stringify({ name: 'x', postCreateCommand: 'node --import ./scripts/w8l/h20.json scripts/w8l/ok.mjs' }, null, 2)}\n`, 'scripts/w8l/h20.json': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['E1 devcontainer compact JSON: node --import ./h.json', { '.devcontainer/w8e1/devcontainer.json': `${JSON.stringify({ postCreateCommand: 'node --import ./scripts/w8l/h1.json scripts/w8l/ok.mjs' })}\n`, 'scripts/w8l/h1.json': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['E3 devcontainer array form: ["node","--import","./h.json",...]', { '.devcontainer/w8e3/devcontainer.json': `${JSON.stringify({ postCreateCommand: ['node', '--import', './scripts/w8l/h3.json', 'scripts/w8l/ok.mjs'] })}\n`, 'scripts/w8l/h3.json': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['E4 devcontainer: node -r ./h.txt', { '.devcontainer/w8e4/devcontainer.json': `${JSON.stringify({ postCreateCommand: 'node -r ./scripts/w8l/h4.txt scripts/w8l/ok.mjs' })}\n`, 'scripts/w8l/h4.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['devcontainer: postStartCommand as an object of commands', { '.devcontainer/w8e5/devcontainer.json': `${JSON.stringify({ postStartCommand: { hook: 'node -r ./scripts/w8l/h5.txt scripts/w8l/ok.mjs' } })}\n`, 'scripts/w8l/h5.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['.vscode/tasks.json: command node with args -r ./h.txt', { '.vscode/w8t/tasks.json': `${JSON.stringify({ version: '2.0.0', tasks: [{ label: 'x', type: 'process', command: 'node', args: ['-r', './scripts/w8l/h6.txt', 'scripts/w8l/ok.mjs'] }] })}\n`, 'scripts/w8l/h6.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['.vscode/launch.json: a node configuration with runtimeArgs -r ./h.txt', { '.vscode/w8u/launch.json': `${JSON.stringify({ version: '0.2.0', configurations: [{ type: 'node', request: 'launch', name: 'x', runtimeArgs: ['-r', './scripts/w8l/h7.txt'], program: '${workspaceFolder}/scripts/w8l/ok.mjs' }] })}\n`, 'scripts/w8l/h7.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['.vscode/launch.json: a node configuration whose program is a data file', { '.vscode/w8v/launch.json': `${JSON.stringify({ version: '0.2.0', configurations: [{ type: 'node', request: 'launch', name: 'x', program: '${workspaceFolder}/scripts/w8l/p8.txt' }] })}\n`, 'scripts/w8l/p8.txt': EVIL8_CJS }],
    ['L29 ps1: . "$PSScriptRoot\\p29.txt" (dot-source of an anchored data file)', { 'scripts/w8l/l29.ps1': '. "$PSScriptRoot\\p29.txt"\n', 'scripts/w8l/p29.txt': `psql -c "${EVIL8_SQL}"\n` }],
    ["E5 ps1: . (Join-Path $PSScriptRoot 'p5.txt')", { 'scripts/w8l/e5.ps1': ". (Join-Path $PSScriptRoot 'p5.txt')\n", 'scripts/w8l/p5.txt': `psql -c "${EVIL8_SQL}"\n` }],
    ['ps1: . $PSScriptRoot/p30.txt (unquoted)', { 'scripts/w8l/l30.ps1': '. $PSScriptRoot/p30.txt\n', 'scripts/w8l/p30.txt': `psql -c "${EVIL8_SQL}"\n` }],
    ['ps1: Import-Module of an anchored module that is not in the repository', { 'scripts/w8l/l31.ps1': 'Import-Module "$PSScriptRoot\\w8-missing.psm1"\n' }],
    ['ps1: . of a path the source does not hold', { 'scripts/w8l/l32.ps1': '. "$env:TOOLS\\x.ps1"\n' }],
    ["L06 npm: NODE_OPTIONS='--require ./h.txt' node ok", { 'tools/w8l06/package.json': npm6({ x: "NODE_OPTIONS='--require ./scripts/w8l/h06.txt' node scripts/w8l/ok.mjs" }), 'scripts/w8l/h06.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['L07 npm: cross-env NODE_OPTIONS=--require=./h.txt node ok', { 'tools/w8l07/package.json': npm6({ x: 'cross-env NODE_OPTIONS=--require=./scripts/w8l/h07.txt node scripts/w8l/ok.mjs' }), 'scripts/w8l/h07.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['sh: export NODE_OPTIONS="--import ./h.json", then node', { 'scripts/w8l/l08.sh': sh8('export NODE_OPTIONS="--import ./scripts/w8l/h08.json"\nnode scripts/w8l/ok.mjs'), 'scripts/w8l/h08.json': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['Dockerfile: ENV NODE_OPTIONS="--require ./h.txt"', { 'deploy/w8l09/Dockerfile': 'FROM node:22\nENV NODE_OPTIONS="--require ./scripts/w8l/h09.txt"\nCMD ["node", "scripts/w8l/ok.mjs"]\n', 'scripts/w8l/h09.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['compose: environment NODE_OPTIONS (mapping)', { 'deploy/w8l10/docker-compose.yml': 'services:\n  m:\n    image: node:22\n    environment:\n      NODE_OPTIONS: --require ./scripts/w8l/h10.txt\n    command: node scripts/w8l/ok.mjs\n', 'scripts/w8l/h10.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['compose: environment NODE_OPTIONS (list)', { 'deploy/w8l11/docker-compose.yml': 'services:\n  m:\n    image: node:22\n    environment:\n      - NODE_OPTIONS=--import ./scripts/w8l/h11.json\n    command: node scripts/w8l/ok.mjs\n', 'scripts/w8l/h11.json': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['CI: env NODE_OPTIONS on a step', { '.github/workflows/w8l12.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node scripts/w8l/ok.mjs\n        env:\n          NODE_OPTIONS: --require ./scripts/w8l/h12.txt\n', 'scripts/w8l/h12.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['.env file: NODE_OPTIONS=--require ./h.txt', { 'tools/w8l13/.env.w8': 'NODE_OPTIONS=--require ./scripts/w8l/h13.txt\n', 'scripts/w8l/h13.txt': EVIL8_CJS }],
    ["ps1: $env:NODE_OPTIONS = '--require ./h.txt'", { 'scripts/w8l/l14.ps1': "$env:NODE_OPTIONS = '--require ./scripts/w8l/h14.txt'\nnode scripts/w8l/ok.mjs\n", 'scripts/w8l/h14.txt': EVIL8_CJS, 'scripts/w8l/ok.mjs': OK8 }],
    ['sh: NODE_OPTIONS from a value the source does not hold', { 'scripts/w8l/l15.sh': sh8('NODE_OPTIONS="$OPTS" node scripts/w8l/ok.mjs'), 'scripts/w8l/ok.mjs': OK8 }],
    ['L10 npm: yarn run $TASK', { 'tools/w8l16/package.json': npm6({ x: 'yarn run $TASK' }) }],
    ['L11 npm: npm run "$npm_config_task"', { 'tools/w8l17/package.json': npm6({ x: 'npm run "$npm_config_task"' }) }],
    ['sh: pnpm run "$X"', { 'scripts/w8l/l18.sh': sh8('pnpm run "$X"') }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfChange(files).length).toBeGreaterThan(0);
  });

  it.each([
    ['devcontainer: postCreateCommand npm ci (no launch)', { '.devcontainer/w8c1/devcontainer.json': `${JSON.stringify({ postCreateCommand: 'npm ci' })}\n` }],
    ['ps1: . "$PSScriptRoot\\lib-ok.ps1" of a harmless script beside it', { 'scripts/w8c/c2.ps1': '. "$PSScriptRoot\\lib-ok.ps1"\n', 'scripts/w8c/lib-ok.ps1': "Write-Host 'ok'\n" }],
    ['npm: NODE_OPTIONS=--max-old-space-size=4096 node ok (no preload)', { 'tools/w8c3/package.json': npm6({ x: 'NODE_OPTIONS=--max-old-space-size=4096 node scripts/w8c/ok.mjs' }), 'scripts/w8c/ok.mjs': OK8 }],
    ['npm: npm run build (a static script name)', { 'tools/w8c4/package.json': npm6({ x: 'npm run build' }) }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfChange(files)).toEqual([]);
  });

  it('KNOWN LIMIT (pinned, BLOCKERARE B3 in the report): E10 npm "yarn run <static unknown bin>" is not caught by this scan', () => {
    expect(problemsOfChange({ 'tools/w8k1/package.json': npm6({ x: 'yarn run pg-wipe-everything' }) })).toEqual([]);
  });
});

describe('canaries: U30F8 mutation round 1 -- what the first canaries left unexercised', () => {
  it.each([
    ['sh: a here-string <<<WORD is no here-document: the next line is still a command', { 'scripts/w8m/m1.sh': '#!/bin/sh\ncat <<<WORD\npsql -c "$1"\n' }],
    ['ts: spawnSync(python3, [-], { input }) -- the stdin script is scanned as Python', { 'scripts/w8m/m2.ts': "import { spawnSync } from 'node:child_process';\nspawnSync('python3', ['-'], { input: \"import os, psycopg2\\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\\n\" });\n" }],
    ['devcontainer: containerEnv NODE_OPTIONS --require ./h.txt', { '.devcontainer/w8m3/devcontainer.json': `${JSON.stringify({ containerEnv: { NODE_OPTIONS: '--require ./scripts/w8m/h3.txt' }, postCreateCommand: 'node scripts/w8m/ok.mjs' })}\n`, 'scripts/w8m/h3.txt': EVIL8_CJS, 'scripts/w8m/ok.mjs': OK8 }],
    ['sh: export NODE_OPTIONS="$OPTS" (a line that runs no program)', { 'scripts/w8m/m4.sh': sh8('export NODE_OPTIONS="$OPTS"') }],
    ['npm: yarn $TASK (yarn runs a script by name)', { 'tools/w8m5/package.json': npm6({ x: 'yarn $TASK' }) }],
    ['.env file: NODE_OPTIONS=${OPTS} (options the source does not hold)', { 'tools/w8m6/.env.w8': 'NODE_OPTIONS=${OPTS}\n' }],
    ['sh: x=$(bash data file) -- a command substitution runs its command', { 'scripts/w8m/m7.sh': sh8('x=$(bash scripts/w8m/m7.txt)'), 'scripts/w8m/m7.txt': EVIL8_SH }],
    ['sh: echo "$(psql -c "$1")"', { 'scripts/w8m/m8.sh': sh8('echo "$(psql -c "$1")"') }],
    ['sh: diff <(psql -c TRUNCATE) expected', { 'scripts/w8m/m9.sh': sh8("diff <(psql -c 'TRUNCATE env.sgu_well') expected.txt") }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfChange(files).length).toBeGreaterThan(0);
  });

  it.each([
    ["sh: cat <<\\EOF > notes (quoted by a backslash): its body is data, not commands", { 'scripts/w8m/c1.sh': '#!/bin/sh\ncat <<\\EOF > notes.txt\npsql -c "$1"\nEOF\n' }],
    ["sh: n=$(psql -t -c 'SELECT 1') (a read in a substitution)", { 'scripts/w8m/c2.sh': sh8("n=$(psql -t -c 'SELECT 1')") }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfChange(files)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// U30F9 (owner decision 2026-10-03: DEFAULT-DENY instead of chasing shell constructions one by one). A DB-capable command
// that holds ANY value the text does not hold -- an expansion, a substitution, a template, a positional parameter, an
// expanding here-document, a cmd/PowerShell/Actions/Go-template placeholder -- is UNRESOLVABLE (NON_LITERAL) unless a
// reviewed, content-pinned entry covers the site. The delta verifier's G8-1..G8-8 forms are CLASSES here, each shown with
// the verifier's own forms and 40+ new ones (languages x quotings x line breaks x nesting), and the gate (TS/Python/
// PowerShell, via corpus.v1.json) and the scanner (this inventory) answer alike.
// ---------------------------------------------------------------------------------------------

const EVIL9_SQL = 'TRUNCATE env.sgu_well';
const EVIL9_SH = `psql postgresql://localhost/x -c "${EVIL9_SQL}"\n`;
const EVIL9_CJS = `require('child_process').execSync('psql -c "${EVIL9_SQL}"');\n`;
const OK9 = 'console.log(1);\n';
const sh9 = (body: string) => `#!/bin/sh\n${body}\n`;
const bash9 = (body: string) => `#!/bin/bash\n${body}\n`;
const npm9 = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) => `${JSON.stringify({ name: 'x', private: true, ...extra, scripts }, null, 2)}\n`;
const ci9 = (run: string, extra = '') => `on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${run}\n${extra}`;
const ciBlock9 = (body: string, extra = '') => `on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n${body.split('\n').map((l) => `          ${l}`).join('\n')}\n${extra}`;
const docker9 = (body: string) => `FROM postgres:16\n${body}\n`;
const compose9 = (command: string) => `services:\n  m:\n    image: x\n    command: ${command}\n`;

type Form9 = { readonly id: string; readonly files: Record<string, string>; readonly violation: boolean };
/** A form per host: the same command line placed where a shell, npm, CI, Docker, compose, PowerShell, JS, Python or cmd runs it. */
function hosts9(tag: string, line: string, psLine: string = `& ${line}`): Form9[] {
  const js = JSON.stringify(line);
  return [
    { id: `${tag} [sh]`, files: { [`scripts/u9/${tag}.sh`]: sh9(line) }, violation: true },
    { id: `${tag} [bash]`, files: { [`scripts/u9/${tag}.bash`]: bash9(line) }, violation: true },
    { id: `${tag} [npm script]`, files: { [`tools/u9/${tag}/package.json`]: npm9({ x: line }) }, violation: true },
    { id: `${tag} [CI run]`, files: { [`.github/workflows/u9-${tag}.yml`]: ciBlock9(line) }, violation: true },
    { id: `${tag} [Dockerfile RUN]`, files: { [`deploy/u9/${tag}/Dockerfile`]: docker9(`RUN ${line}`) }, violation: true },
    { id: `${tag} [compose command]`, files: { [`deploy/u9/${tag}/docker-compose.yml`]: compose9(JSON.stringify(line)) }, violation: true },
    { id: `${tag} [PowerShell &]`, files: { [`scripts/u9/${tag}.ps1`]: `${psLine}\n` }, violation: true },
    { id: `${tag} [JS execSync]`, files: { [`scripts/u9/${tag}.mjs`]: `import { execSync } from 'node:child_process';\nexecSync(${js});\n` }, violation: true },
    { id: `${tag} [Python os.system]`, files: { [`scripts/u9/${tag}.py`]: `import os\nos.system(${js})\n` }, violation: true },
  ];
}

function caughtAndControls9(tag: string, violations: Form9[], controls: Form9[], minimum: number) {
  describe(`U30F9 class ${tag}`, () => {
    it(`holds at least ${minimum} violating forms (${violations.length}) and ${controls.length} controls`, () => {
      expect(violations.length).toBeGreaterThanOrEqual(minimum);
      expect(new Set([...violations, ...controls].map((c) => c.id)).size).toBe(violations.length + controls.length);
    });
    it.each(violations.map((c) => [c.id, c] as const))('%s -> caught', (_id, c) => {
      expect(problemsOfChange(c.files).length, `MISSED: ${c.id}`).toBeGreaterThan(0);
    });
    it.each(controls.map((c) => [c.id, c] as const))('control: %s passes', (_id, c) => {
      expect(problemsOfChange(c.files)).toEqual([]);
    });
  });
}

// ---- DD-1: a DB-capable tool with any non-literal value (the default-deny core) ----
{
  /** Non-literal values as a POSIX shell writes them (each is a different construction class the splitter must read as a value). */
  const SH_VALUES: readonly [string, string][] = [
    ['var', '"$SQL"'],
    ['braced', '"${SQL}"'],
    ['default', '"${SQL:-SELECT 1}"'],
    ['subst', '"$(cat q.sql)"'],
    ['backtick', '"`cat q.sql`"'],
    ['positional', '"$1"'],
    ['all-args', '"$@"'],
    ['unquoted-positional', '$2'],
    ['star', '"$*"'],
    ['nested-subst', '"$(echo "$(cat q.sql)")"'],
  ];
  /** Tool invocations with one value slot V: the slot is a connection, the SQL, a file, a source path or the program. */
  const TOOLS: readonly [string, (v: string) => string][] = [
    ['psql -c V', (v) => `psql -c ${v}`],
    ['psql V -c SELECT', (v) => `psql ${v} -c "SELECT 1"`],
    ['psql -d V', (v) => `psql -d ${v} -c "SELECT 1"`],
    ['psql -f V', (v) => `psql -f ${v}`],
    ['usql -c V', (v) => `usql pg://x -c ${v}`],
    ['pgbench -f V', (v) => `pgbench -n -f ${v} -t 1 postgresql://localhost/x`],
    ['ogr2ogr PG source V', (v) => `ogr2ogr -f PostgreSQL PG:dbname=x ${v} -nln stage.u9 -overwrite`],
    ['ogr2ogr V datasource', (v) => `ogr2ogr -f PostgreSQL ${v} a.gpkg -nln stage.u9 -overwrite`],
    ['ogrinfo -sql V', (v) => `ogrinfo PG:dbname=x -sql ${v}`],
    ['pg_restore -d V', (v) => `pg_restore -d ${v} -t stage.u9 dump.backup`],
    ['shp2pgsql V | psql', (v) => `shp2pgsql -s 3006 ${v} stage.u9 | psql postgresql://localhost/x`],
    ['dropdb V', (v) => `dropdb ${v}`],
    ['prisma migrate --schema V', (v) => `npx prisma migrate deploy --schema ${v}`],
    ['docker exec psql -c V', (v) => `docker exec -i db psql -U u -c ${v}`],
    ['sudo psql -c V', (v) => `sudo -u postgres psql -c ${v}`],
    ['V program', (v) => `${v} -c "SELECT 1"`],
    ['pg_dump V | psql', (v) => `pg_dump ${v} | psql postgresql://localhost/dst`],
  ];
  const violations: Form9[] = [];
  TOOLS.forEach(([tname, render], t) => {
    const [vname, value] = SH_VALUES[t % SH_VALUES.length]!;
    const [vname2, value2] = SH_VALUES[(t + 3) % SH_VALUES.length]!;
    violations.push({ id: `DD1 ${tname} with ${vname}`, files: { [`scripts/u9/dd1-${t}a.sh`]: sh9(render(value)) }, violation: true });
    violations.push({ id: `DD1 ${tname} with ${vname2} [bash]`, files: { [`scripts/u9/dd1-${t}b.sh`]: bash9(render(value2)) }, violation: true });
  });
  // the same core across hosts (the value spelled as each host expands it)
  violations.push(...hosts9('dd1-psql-env', 'psql "$DATABASE_URL" -c "SELECT 1"', '& psql $env:DATABASE_URL -c "SELECT 1"'));
  violations.push(...hosts9('dd1-ogr-env', 'ogr2ogr -f PostgreSQL "PG:$PGDSN" a.gpkg -nln stage.u9 -overwrite', '& ogr2ogr -f PostgreSQL "PG:$env:PGDSN" a.gpkg -nln stage.u9 -overwrite'));
  violations.push(
    { id: 'DD1 cmd psql %DB% -c SELECT', files: { 'scripts/u9/dd1-cmd1.cmd': '@echo off\r\npsql %DB% -c "SELECT 1"\r\n' }, violation: true },
    { id: 'DD1 cmd psql -c !SQL! (delayed expansion)', files: { 'scripts/u9/dd1-cmd2.cmd': '@echo off\r\nsetlocal EnableDelayedExpansion\r\nset SQL=SELECT 1\r\npsql -c "!SQL!"\r\n' }, violation: true },
    { id: 'DD1 cmd ogr2ogr PG:%DSN%', files: { 'scripts/u9/dd1-cmd3.cmd': '@echo off\r\nogr2ogr -f PostgreSQL "PG:%DSN%" a.gpkg -nln stage.u9\r\n' }, violation: true },
    { id: 'DD1 ps1 & psql -c $sql', files: { 'scripts/u9/dd1-ps1.ps1': 'param([string]$sql)\n& psql -c $sql\n' }, violation: true },
    { id: 'DD1 ps1 psql -h $h -c SELECT', files: { 'scripts/u9/dd1-ps2.ps1': 'param([string]$h)\npsql -h $h -U u -c "SELECT 1"\n' }, violation: true },
    { id: 'DD1 ps1 & $env:PSQL -c SELECT (program from the environment)', files: { 'scripts/u9/dd1-ps3.ps1': '& $env:PSQL -c "SELECT 1"\n' }, violation: true },
    { id: 'DD1 ps1 ogr2ogr "$db" (variable datasource)', files: { 'scripts/u9/dd1-ps4.ps1': '$db = "PG:$env:PGDSN"\n& ogr2ogr -f PostgreSQL $db a.gpkg -nln stage.u9 -overwrite\n' }, violation: true },
    { id: 'DD1 js execSync template psql ${url} -c SELECT', files: { 'scripts/u9/dd1-js1.mjs': "import { execSync } from 'node:child_process';\nconst url = process.env.DATABASE_URL;\nexecSync(`psql ${url} -c \"SELECT 1\"`);\n" }, violation: true },
    { id: 'DD1 js spawnSync psql with a dynamic -d', files: { 'scripts/u9/dd1-js2.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('psql', ['-d', process.env.DB, '-c', 'SELECT 1']);\n" }, violation: true },
    { id: 'DD1 js spawnSync ogr2ogr PG:${dsn} static unprotected target', files: { 'scripts/u9/dd1-js3.mjs': "import { spawnSync } from 'node:child_process';\nconst dsn = process.env.DSN;\nspawnSync('ogr2ogr', ['-f', 'PostgreSQL', `PG:${dsn}`, 'a.gpkg', '-nln', 'stage.u9', '-overwrite']);\n" }, violation: true },
    { id: 'DD1 js spawnSync(OGR2OGR_PATH, static args) -- the program is a value', files: { 'scripts/u9/dd1-js4.mjs': "import { spawnSync } from 'node:child_process';\nconst OGR2OGR_PATH = process.env.OGR2OGR_PATH;\nspawnSync(OGR2OGR_PATH, ['-f', 'PostgreSQL', 'PG:dbname=x', 'a.gpkg', '-nln', 'stage.u9', '-overwrite']);\n" }, violation: true },
    { id: 'DD1 py subprocess psql -c f-string', files: { 'scripts/u9/dd1-py1.py': "import os, subprocess\nsql = os.environ['SQL']\nsubprocess.run(['psql', '-c', f'{sql}'])\n" }, violation: true },
    { id: 'DD1 py subprocess psql dsn variable', files: { 'scripts/u9/dd1-py2.py': "import os, subprocess\ndsn = os.environ['DSN']\nsubprocess.run(['psql', dsn, '-c', 'SELECT 1'])\n" }, violation: true },
    { id: 'DD1 py os.system ogr2ogr PG:{dsn}', files: { 'scripts/u9/dd1-py3.py': "import os\ndsn = os.environ['DSN']\nos.system(f'ogr2ogr -f PostgreSQL \"PG:{dsn}\" a.gpkg -nln stage.u9')\n" }, violation: true },
    { id: 'DD1 sh psql with an expanding here-document (connection static)', files: { 'scripts/u9/dd1-hd1.sh': '#!/bin/sh\npsql postgresql://localhost/x <<EOF\nSELECT $N;\nEOF\n' }, violation: true },
    { id: 'DD1 sh psql < "$FILE" (stdin file from a value)', files: { 'scripts/u9/dd1-hd2.sh': sh9('psql postgresql://localhost/x < "$FILE"') }, violation: true },
    { id: 'DD1 sh psql <<< "$SQL"', files: { 'scripts/u9/dd1-hd3.sh': bash9('psql postgresql://localhost/x <<< "$SQL"') }, violation: true },
    { id: 'DD1 CI psql -c "${{ inputs.sql }}" (H35)', files: { '.github/workflows/u9-dd1-h35.yml': ci9('psql -c "${{ github.event.inputs.sql }}"') }, violation: true },
    { id: 'DD1 Taskfile psql -c "{{.SQL}}"', files: { 'tools/u9/dd1/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - psql -c \"{{.SQL}}\"\n" }, violation: true },
    { id: 'DD1 sh "$PSQL_BIN" -c "$1" (Z10: gate and scanner agree now)', files: { 'scripts/u9/dd1-z10.sh': sh9('"$PSQL_BIN" -c "$1"') }, violation: true },
    { id: 'DD1 sh "$PSQL_BIN" -c SELECT (the program is a value)', files: { 'scripts/u9/dd1-z10b.sh': sh9('"$PSQL_BIN" -c "SELECT 1"') }, violation: true },
    { id: 'DD1 sh $CMD -c "$1" (Z12)', files: { 'scripts/u9/dd1-z12.sh': sh9('$CMD -c "$1"') }, violation: true },
    { id: 'DD1 sh ${PSQL:-psql} -c SELECT', files: { 'scripts/u9/dd1-z12b.sh': sh9('${PSQL:-psql} -c "SELECT 1"') }, violation: true },
    { id: 'DD1 sh "$(which psql)" -c SELECT', files: { 'scripts/u9/dd1-z12c.sh': sh9('"$(which psql)" -c "SELECT 1"') }, violation: true },
    { id: 'DD1 sh psql -v id="$1" -c static SELECT (PC4: a value in a psql command)', files: { 'scripts/u9/dd1-pc4.sh': sh9('psql -v id="$1" -c "SELECT * FROM public.x WHERE id = :id"') }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'DD1 psql with a literal connection and a static read', files: { 'scripts/u9/dd1-c1.sh': sh9('psql postgresql://localhost/x -c "SELECT 1"') }, violation: false },
    { id: 'DD1 psql -c static unprotected write, literal connection', files: { 'scripts/u9/dd1-c2.sh': sh9("psql -h localhost -U u -d x -c 'TRUNCATE stage.scratch'") }, violation: false },
    { id: 'DD1 pg_dump "$DB" > out.sql (a dump that reaches no psql writes nothing)', files: { 'scripts/u9/dd1-c3.sh': sh9('pg_dump "$DB" > out.sql') }, violation: false },
    { id: 'DD1 pg_dump "$DB" | gzip > out.sql.gz', files: { 'scripts/u9/dd1-c4.sh': sh9('pg_dump "$DB" | gzip > out.sql.gz') }, violation: false },
    { id: 'DD1 ogrinfo -ro -so "$GPKG" layer (read-only, no -sql)', files: { 'scripts/u9/dd1-c5.sh': sh9('ogrinfo -ro -so "$GPKG" byggnad') }, violation: false },
    { id: 'DD1 ogrinfo -so -al "$GPKG" (no -sql: cannot write)', files: { 'scripts/u9/dd1-c6.sh': sh9('ogrinfo -so -al "$GPKG"') }, violation: false },
    { id: 'DD1 ogrinfo -ro PG:dbname=x -sql \'SELECT count(*) FROM "$T"\' (read-only mode exempts the value from NON_LITERAL; a read with a value in a name position is no statement whose verb is a value)', files: { 'scripts/u9/dd1-c7.sh': sh9('ogrinfo -ro PG:dbname=x -sql "SELECT count(*) FROM public.t WHERE id = $ID"') }, violation: false },
    { id: 'DD1 gdal_translate -of COG "$IN" out.tif (a file output)', files: { 'scripts/u9/dd1-c8.sh': sh9('gdal_translate -of COG -co COMPRESS=DEFLATE "$IN" out.tif') }, violation: false },
    { id: 'DD1 gdalwarp -of GTiff "$IN" "$OUT" (a file output)', files: { 'scripts/u9/dd1-c9.sh': sh9('gdalwarp -of GTiff -t_srs EPSG:3006 "$IN" "$OUT"') }, violation: false },
    { id: 'DD1 ogr2ogr -f GPKG out.gpkg "$IN" (a file output)', files: { 'scripts/u9/dd1-c10.sh': sh9('ogr2ogr -f GPKG out.gpkg "$IN" -nln layer') }, violation: false },
    { id: 'DD1 npx prisma generate --schema "$S" (no database)', files: { 'tools/u9/dd1-c11/package.json': npm9({ gen: 'npx prisma generate --schema "$S"' }) }, violation: false },
    { id: 'DD1 bash -c "echo $HOME" (a shell runs no DB tool)', files: { 'scripts/u9/dd1-c12.sh': sh9('bash -c "echo $HOME is set"') }, violation: false },
    { id: "DD1 psql -c 'SELECT $1' (single quotes: a bind parameter, no value)", files: { 'scripts/u9/dd1-c13.sh': sh9("psql postgresql://localhost/x -c 'SELECT $1'") }, violation: false },
    { id: "DD1 psql <<'EOF' with $1 inside (quoted delimiter: no expansion)", files: { 'scripts/u9/dd1-c14.sh': "#!/bin/sh\npsql postgresql://localhost/x <<'EOF'\nSELECT $1;\nEOF\n" }, violation: false },
    { id: 'DD1 docker exec "$C" psql -c SELECT (the value names the container, before the tool)', files: { 'scripts/u9/dd1-c15.sh': sh9('docker exec -i "$CONTAINER" psql -U u -d x -c "SELECT 1"') }, violation: false },
    { id: 'DD1 ps1 & psql -c "SELECT 1" static', files: { 'scripts/u9/dd1-c16.ps1': "& psql -h localhost -c 'SELECT 1'\n" }, violation: false },
    { id: 'DD1 js spawnSync psql static', files: { 'scripts/u9/dd1-c17.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('psql', ['-h', 'localhost', '-c', 'SELECT 1']);\n" }, violation: false },
    { id: 'DD1 cmd psql static', files: { 'scripts/u9/dd1-c18.cmd': '@echo off\r\npsql -h localhost -c "SELECT 1"\r\n' }, violation: false },
  ];
  caughtAndControls9('DD-1 (a DB-capable tool with a non-literal value)', violations, controls, 40);
}

// ---- K1 (G8-1): backticks outside a here-document are command substitutions ----
{
  const INNER: readonly [string, string][] = [
    ['psql -c "$1"', 'psql -c "$1"'],
    ['psql -c "$SQL"', 'psql -c "$SQL"'],
    ["psql -c 'TRUNCATE env.sgu_well' (static protected)", "psql -c 'TRUNCATE env.sgu_well'"],
    ['psql "$DB" -c SELECT (DD-1)', 'psql "$DB" -c "SELECT 1"'],
    ['ogrinfo PG -sql "$1"', 'ogrinfo PG:dbname=x -sql "$1"'],
    ['docker exec db psql -c "$1"', 'docker exec -i db psql -c "$1"'],
    ['bash data file', 'bash scripts/u9/k1-evil.txt'],
    ['pg_restore -d "$DB" dump', 'pg_restore -d "$DB" -t stage.u9 dump.backup'],
  ];
  const OUTER: readonly [string, (inner: string) => string][] = [
    ['x=`...`', (i) => `x=\`${i}\``],
    ['echo `...`', (i) => `echo \`${i}\``],
    ['echo "`...`"', (i) => `echo "\`${i.replace(/"/g, '\\"')}\`"`],
    ['if [ "`...`" = x ]', (i) => `if [ "\`${i.replace(/"/g, '\\"')}\`" = x ]; then :; fi`],
    ['for r in `...`', (i) => `for r in \`${i}\`; do echo "$r"; done`],
    ['export Y=`...`', (i) => `export Y=\`${i}\``],
    ['local y=`...` in a function', (i) => `f() {\n  local y=\`${i}\`\n  echo "$y"\n}\nf`],
    ['nested $(echo `...`)', (i) => `echo $(echo \`${i}\`)`],
    ['`...` > out.txt', (i) => `\`${i}\` > out.txt`],
    ['x="prefix `...` suffix"', (i) => `x="prefix \`${i.replace(/"/g, '\\"')}\` suffix"`],
    ['[ -n "`...`" ]', (i) => `[ -n "\`${i.replace(/"/g, '\\"')}\`" ] && echo yes`],
    ['case `...` in', (i) => `case \`${i}\` in\n  *) echo x ;;\nesac`],
  ];
  const violations: Form9[] = [];
  OUTER.forEach(([oname, render], o) => {
    INNER.forEach(([iname, inner], n) => {
      if ((o + n) % 2 === 1 && o > 1) return; // every outer form with half the inner ones: 8 + 8 + 5*6 = 46 shell forms
      violations.push({ id: `K1 ${oname} :: ${iname} [sh]`, files: { [`scripts/u9/k1-${o}-${n}.sh`]: sh9(render(inner)), 'scripts/u9/k1-evil.txt': EVIL9_SH }, violation: true });
    });
  });
  violations.push(
    ...hosts9('k1-hosts-dyn', 'x=`psql -c "$1"`', '$x = $(psql -c $args[0])'),
    { id: 'K1 Z01 x=`psql -c "$1"` (verifier)', files: { 'scripts/u9/k1-z01.sh': sh9('x=`psql -c "$1"`') }, violation: true },
    { id: 'K1 Z02 echo `psql -c "$SQL"` (verifier)', files: { 'scripts/u9/k1-z02.sh': sh9('echo `psql -c "$SQL"`') }, violation: true },
    { id: 'K1 Z03 echo "`psql -c \\"$1\\"`" (verifier)', files: { 'scripts/u9/k1-z03.sh': sh9('echo "`psql -c \\"$1\\"`"') }, violation: true },
    { id: 'K1 X02 x=`psql -c "TRUNCATE env.sgu_well"` (verifier, static protected)', files: { 'scripts/u9/k1-x02.sh': sh9('x=`psql -c "TRUNCATE env.sgu_well"`') }, violation: true },
    { id: 'K1 backticks across two lines', files: { 'scripts/u9/k1-ml.sh': sh9('x=`psql \\\n  -c "$1"`') }, violation: true },
    { id: 'K1 zsh backticks', files: { 'scripts/u9/k1-zsh.zsh': `#!/bin/zsh\nx=\`psql -c "$1"\`\n` }, violation: true },
    { id: 'K1 backticks inside bash -c', files: { 'scripts/u9/k1-bashc.sh': sh9('bash -c \'x=`psql -c "$1"`\'') }, violation: true },
    { id: 'K1 backticks in an npm script with a static protected inner', files: { 'tools/u9/k1-npm/package.json': npm9({ x: 'echo `psql -c "TRUNCATE env.sgu_well"`' }) }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K1 x=`date` (ZC1)', files: { 'scripts/u9/k1-c1.sh': sh9('x=`date`') }, violation: false },
    { id: 'K1 echo "$(date) `hostname`" (X13)', files: { 'scripts/u9/k1-c2.sh': sh9('echo "$(date) `hostname`"') }, violation: false },
    { id: "K1 echo '`psql -c \"$1\"`' (X14: single quotes, no substitution)", files: { 'scripts/u9/k1-c3.sh': sh9("echo '`psql -c \"$1\"`'") }, violation: false },
    { id: "K1 n=`psql postgresql://localhost/x -t -c 'SELECT 1'` (a literal read)", files: { 'scripts/u9/k1-c4.sh': sh9("n=`psql postgresql://localhost/x -t -c 'SELECT 1'`") }, violation: false },
    { id: 'K1 PowerShell `n in a string is no substitution', files: { 'scripts/u9/k1-c5.ps1': 'Write-Host "line one`nline two"\n' }, violation: false },
  ];
  caughtAndControls9('K1 (G8-1: backticks outside a here-document)', violations, controls, 40);
}

// ---- K2 (G8-2): PowerShell ( ... ), $( ... ), @( ... ) and "$( ... )" are pipelines of their own ----
{
  const INNER: readonly [string, string][] = [
    ['psql -c $args[0]', 'psql -c $args[0]'],
    ['& psql -c $q', '& psql -c $q'],
    ["psql -c 'TRUNCATE env.sgu_well' (static protected)", "psql -c 'TRUNCATE env.sgu_well'"],
    ['psql -c $sql', 'psql -c $sql'],
    ['ogr2ogr -f PostgreSQL $db a.gpkg -nln stage.u9', 'ogr2ogr -f PostgreSQL $db a.gpkg -nln stage.u9 -overwrite'],
    ['ogrinfo PG:dbname=x -sql $q', 'ogrinfo PG:dbname=x -sql $q'],
    ['docker exec db psql -c $q', 'docker exec -i db psql -c $q'],
    ['& $env:PSQL -c $q', '& $env:PSQL -c $q'],
    ['psql -c $PSBoundParameters[\'Sql\']', "psql -c $PSBoundParameters['Sql']"],
    ['psql -c $args', 'psql -c $args'],
  ];
  const OUTER: readonly [string, (inner: string) => string][] = [
    ['$x = ( ... )', (i) => `$x = (${i})`],
    ['$x = $( ... )', (i) => `$x = $(${i})`],
    ['$x = @( ... )', (i) => `$x = @(${i})`],
    ['Write-Output "$( ... )"', (i) => `Write-Output "$(${i})"`],
    ['Write-Host "a $( ... ) b"', (i) => `Write-Host "prefix $(${i}) suffix"`],
    ['if (( ... ) -match x)', (i) => `if ((${i}) -match 'x') { Write-Host hit }`],
    ['foreach ($l in ( ... ))', (i) => `foreach ($l in (${i})) { Write-Host $l }`],
    ['[int]( ... )', (i) => `$n = [int](${i})`],
    ['( ... ) | Out-File', (i) => `(${i}) | Out-File out.txt`],
    ['"x" + ( ... )', (i) => `$m = "x" + (${i})`],
    ['(( ... )) nested', (i) => `$y = ((${i}))`],
    ['"$(( ... ))" nested in a string', (i) => `$w = "$((${i}))"`],
    ['return ( ... ) in a function', (i) => `function f {\n  return (${i})\n}\nf`],
    ['( ... ) 2>$null', (i) => `$k = (${i} 2>$null)`],
    ['( ... ) | Select-Object', (i) => `$j = (${i} | Select-Object -First 1)`],
    ['("$( ... )" -replace)', (i) => `$g = ("$(${i})" -replace 'a', 'b')`],
    ['-join ( ... )', (i) => `$s = -join (${i})`],
    ['( ... ) across lines', (i) => `$x = (\n  ${i}\n)`],
  ];
  const violations: Form9[] = [];
  OUTER.forEach(([oname, render], o) => {
    INNER.forEach(([iname, inner], n) => {
      if ((o + n) % 3 !== 0) return; // 18 x 10 / 3 = 60 forms
      violations.push({ id: `K2 ${oname} :: ${iname}`, files: { [`scripts/u9/k2-${o}-${n}.ps1`]: `param([string]$q, [string]$sql, [string]$db)\n${render(inner)}\n` }, violation: true });
    });
  });
  violations.push(
    { id: 'K2 Z04 $x = $(psql -c TRUNCATE) (verifier)', files: { 'scripts/u9/k2-z04.ps1': `$x = $(psql -c '${EVIL9_SQL}')\n` }, violation: true },
    { id: 'K2 Z05 $x = (psql -c $args[0]) (verifier)', files: { 'scripts/u9/k2-z05.ps1': '$x = (psql -c $args[0])\n' }, violation: true },
    { id: 'K2 Z06 Write-Output "$(psql -c $args[0])" (verifier)', files: { 'scripts/u9/k2-z06.ps1': 'Write-Output "$(psql -c $args[0])"\n' }, violation: true },
    { id: 'K2 Z07 "prefix $(& psql -c $q) suffix" (verifier)', files: { 'scripts/u9/k2-z07.ps1': 'param([string]$q)\n$m = "prefix $(& psql -c $q) suffix"\n' }, violation: true },
    { id: 'K2 X10 Write-Host "$(psql -c $args[0])" (verifier)', files: { 'scripts/u9/k2-x10.ps1': 'Write-Host "$(psql -c $args[0])"\n' }, violation: true },
    { id: 'K2 X11 Write-Host "$(psql -c TRUNCATE)" static (verifier)', files: { 'scripts/u9/k2-x11.ps1': `Write-Host "$(psql -c '${EVIL9_SQL}')"\n` }, violation: true },
    { id: 'K2 a subexpression inside a here-string', files: { 'scripts/u9/k2-hs.ps1': '$t = @"\nresult: $(psql -c $args[0])\n"@\n' }, violation: true },
    { id: 'K2 a subexpression as a hashtable value', files: { 'scripts/u9/k2-ht.ps1': '$h = @{ rows = (psql -c $args[0]) }\n' }, violation: true },
    { id: 'K2 a subexpression as a cmdlet argument', files: { 'scripts/u9/k2-arg.ps1': 'Set-Content -Path out.txt -Value (psql -c $args[0])\n' }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K2 $d = (Get-Date)', files: { 'scripts/u9/k2-c1.ps1': '$d = (Get-Date)\nWrite-Host $d\n' }, violation: false },
    { id: 'K2 "$(Get-Location)"', files: { 'scripts/u9/k2-c2.ps1': 'Write-Host "here: $(Get-Location)"\n' }, violation: false },
    { id: "K2 $x = (psql -h localhost -c 'SELECT 1') (a literal read)", files: { 'scripts/u9/k2-c3.ps1': "$x = (psql -h localhost -c 'SELECT 1')\n" }, violation: false },
    { id: 'K2 $y = @(1, 2, 3)', files: { 'scripts/u9/k2-c4.ps1': '$y = @(1, 2, 3)\nWrite-Host $y.Count\n' }, violation: false },
    { id: 'K2 $z = $(1 + 2)', files: { 'scripts/u9/k2-c5.ps1': '$z = $(1 + 2)\n' }, violation: false },
  ];
  caughtAndControls9('K2 (G8-2: PowerShell sub-pipelines and "$( )" strings)', violations, controls, 40);
}

// ---- K3 (G8-3): Dockerfile RUN here-documents ----
{
  const BODIES: readonly [string, string][] = [
    ['psql -c "$SQL"', 'psql -c "$SQL"'],
    ['psql -c static protected', `psql -c "${EVIL9_SQL}"`],
    ['psql "$DB" -c SELECT (DD-1)', 'psql "$DB" -c "SELECT 1"'],
    ['bash data file', 'bash scripts/u9/k3-evil.txt'],
    ['ogr2ogr PG with $DSN', 'ogr2ogr -f PostgreSQL "PG:$DSN" a.gpkg -nln stage.u9'],
    ['two commands, psql second', 'echo start\npsql -c "$SQL"'],
  ];
  const MARKERS: readonly [string, string, string][] = [
    ['<<EOF', '<<EOF', 'EOF'],
    ['<<-EOF (tabs)', '<<-EOF', 'EOF'],
    ["<<'EOF' (quoted)", "<<'EOF'", 'EOF'],
    ['<<"EOF"', '<<"EOF"', 'EOF'],
    ['<<SH', '<<SH', 'SH'],
    ['<<\\EOF', '<<\\EOF', 'EOF'],
  ];
  const PROGRAMS: readonly [string, (marker: string) => string][] = [
    ['default shell', (m) => `RUN ${m}`],
    ['bash', (m) => `RUN ${m} bash`],
    ['sh -e', (m) => `RUN ${m} sh -e`],
    ['bash before the marker', (m) => `RUN bash ${m}`],
    ['--mount then marker', (m) => `RUN --mount=type=cache,target=/root/.cache ${m}`],
  ];
  const violations: Form9[] = [];
  let n = 0;
  for (const [bname, body] of BODIES) {
    for (const [mname, marker, delim] of MARKERS) {
      for (const [pname, head] of PROGRAMS) {
        if ((n += 1) % 4 !== 0) continue; // 6 x 6 x 5 / 4 = 45 forms
        const lines = body.split('\n').map((l) => (marker.startsWith('<<-') ? `\t${l}` : l)).join('\n');
        const file = n % 3 === 0 ? `deploy/u9/k3-${n}/Dockerfile` : n % 3 === 1 ? `deploy/u9/k3-${n}/Dockerfile.prod` : `deploy/u9/k3-${n}/app.dockerfile`;
        violations.push({ id: `K3 ${head('<<X').replace('<<X', mname)} [${pname}] :: ${bname}`, files: { [file]: `FROM postgres:16\n${head(marker)}\n${lines}\n${marker.startsWith('<<-') ? '\t' : ''}${delim}\n`, 'scripts/u9/k3-evil.txt': EVIL9_SH }, violation: true });
      }
    }
  }
  violations.push(
    { id: 'K3 H33 RUN <<EOF psql -c "$SQL" (verifier)', files: { 'deploy/u9/k3-h33/Dockerfile': 'FROM postgres:16\nRUN <<EOF\npsql -c "$SQL"\nEOF\n' }, violation: true },
    { id: 'K3 H34 RUN <<EOF static protected (verifier)', files: { 'deploy/u9/k3-h34/Dockerfile': `FROM postgres:16\nRUN <<EOF\npsql -c "${EVIL9_SQL}"\nEOF\n` }, violation: true },
    { id: 'K3 Z15 RUN <<-EOF bash with $SQL (verifier)', files: { 'deploy/u9/k3-z15/Dockerfile': 'FROM postgres:16\nRUN <<-EOF bash\n\tpsql -c "$SQL"\n\tEOF\n' }, violation: true },
    { id: 'K3 Z16 heredoc then a normal RUN with static protected (verifier)', files: { 'deploy/u9/k3-z16/Dockerfile': `FROM postgres:16\nRUN <<EOF\necho hi\nEOF\nRUN psql -c "${EVIL9_SQL}"\n` }, violation: true },
    { id: 'K3 RUN python3 <<PY with os.system psql $SQL', files: { 'deploy/u9/k3-py/Dockerfile': 'FROM python:3.12\nRUN python3 <<PY\nimport os\nos.system("psql -c \'$SQL\'")\nPY\n' }, violation: true },
    { id: "K3 RUN python3 <<'PY' static code executing SQL from the environment", files: { 'deploy/u9/k3-py2/Dockerfile': "FROM python:3.12\nRUN python3 <<'PY'\nimport os, psycopg2\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\nPY\n" }, violation: true },
    { id: 'K3 RUN node <<JS execSync(process.env.CMD)', files: { 'deploy/u9/k3-node/Dockerfile': "FROM node:22\nRUN node <<JS\nrequire('child_process').execSync(process.env.CMD);\nJS\n" }, violation: true },
    { id: 'K3 two here-documents in one RUN, the second to psql', files: { 'deploy/u9/k3-two/Dockerfile': 'FROM postgres:16\nRUN cat <<A > /tmp/a && psql <<B\nfirst\nA\n$SQL\nB\n' }, violation: true },
    { id: 'K3 ARG SQL then RUN <<EOF psql -c "$SQL"', files: { 'deploy/u9/k3-arg/Dockerfile': 'FROM postgres:16\nARG SQL\nRUN <<EOF\npsql -c "$SQL"\nEOF\n' }, violation: true },
    { id: 'K3 ENV then RUN psql -c "${SQL}" (ENV expansion is a value)', files: { 'deploy/u9/k3-env/Dockerfile': 'FROM postgres:16\nENV SQL="SELECT 1"\nRUN psql -c "${SQL}"\n' }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K3 RUN <<EOF echo hi', files: { 'deploy/u9/k3-c1/Dockerfile': 'FROM postgres:16\nRUN <<EOF\necho hi\napt-get update\nEOF\n' }, violation: false },
    { id: 'K3 COPY <<EOF /x.txt (a file, not a command)', files: { 'deploy/u9/k3-c2/Dockerfile': 'FROM postgres:16\nCOPY <<EOF /notes.txt\nnotes about psql\nEOF\n' }, violation: false },
    { id: "K3 RUN <<EOF psql -h localhost -c 'SELECT 1' (a literal read)", files: { 'deploy/u9/k3-c3/Dockerfile': "FROM postgres:16\nRUN <<EOF\npsql -h localhost -U u -d x -c 'SELECT 1'\nEOF\n" }, violation: false },
  ];
  caughtAndControls9('K3 (G8-3: Dockerfile RUN here-documents)', violations, controls, 40);
}

// ---- K4 (G8-4): GitHub Actions ${{ }} as a command, and {{ }} templates ----
{
  const EXPRS = ['${{ inputs.cmd }}', '${{ github.event.issue.title }}', '${{ github.event.inputs.sql }}', '${{ secrets.DB_URL }}', '${{ env.SQL }}', '${{ matrix.sql }}', "${{ format('{0}', inputs.x) }}", '${{ steps.a.outputs.cmd }}'];
  const FORMS: readonly [string, (e: string) => string][] = [
    ['bash -c "E"', (e) => `bash -c "${e}"`],
    ['sh -c "E"', (e) => `sh -c "${e}"`],
    ['E bare (a program from an expression)', (e) => e],
    ['psql -c "E"', (e) => `psql -c "${e}"`],
    ['psql "E" -c SELECT', (e) => `psql "${e}" -c "SELECT 1"`],
    ['node -e "E"', (e) => `node -e "${e}"`],
    ['python -c "E"', (e) => `python -c "${e}"`],
    ['eval "E"', (e) => `eval "${e}"`],
    ['"E" -c SELECT (tool from an expression)', (e) => `"${e}" -c "SELECT 1"`],
    ['ogr2ogr PG "E"', (e) => `ogr2ogr -f PostgreSQL "${e}" a.gpkg -nln stage.u9`],
    ['docker exec db psql -c "E"', (e) => `docker exec -i db psql -c "${e}"`],
    ['bash E (a script from an expression)', (e) => `bash ${e}`],
  ];
  const violations: Form9[] = [];
  FORMS.forEach(([fname, render], f) => {
    EXPRS.forEach((e, n) => {
      if ((f + n) % 2 !== 0) return; // 12 x 8 / 2 = 48 forms
      violations.push({ id: `K4 ${fname} :: ${e}`, files: { [`.github/workflows/u9-k4-${f}-${n}.yml`]: (f + n) % 4 === 0 ? ciBlock9(render(e)) : ci9(render(e)) }, violation: true });
    });
  });
  violations.push(
    { id: 'K4 H37 bash -c "${{ github.event.issue.title }}" (verifier)', files: { '.github/workflows/u9-h37.yml': ci9('bash -c "${{ github.event.issue.title }}"') }, violation: true },
    { id: 'K4 Z13 bash -c "${{ inputs.cmd }}" (verifier)', files: { '.github/workflows/u9-z13.yml': ci9('bash -c "${{ inputs.cmd }}"') }, violation: true },
    { id: 'K4 Z14 sh -c "${{ github.event.issue.title }}" (verifier)', files: { '.github/workflows/u9-z14.yml': ci9('sh -c "${{ github.event.issue.title }}"') }, violation: true },
    { id: 'K4 H36 run: | psql <<EOF ${{ inputs.sql }} (verifier)', files: { '.github/workflows/u9-h36.yml': ciBlock9('psql "$DB" <<EOF\n${{ inputs.sql }}\nEOF') }, violation: true },
    { id: 'K4 shell: pwsh with & psql -c "${{ inputs.sql }}"', files: { '.github/workflows/u9-pwsh.yml': 'on: push\njobs:\n  x:\n    runs-on: windows-latest\n    steps:\n      - shell: pwsh\n        run: "& psql -c \\"${{ inputs.sql }}\\""\n' }, violation: true },
    { id: 'K4 shell: python with os.system psql ${{ }}', files: { '.github/workflows/u9-py.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - shell: python\n        run: |\n          import os\n          os.system("psql -c \'${{ inputs.sql }}\'")\n' }, violation: true },
    { id: 'K4 env: SQL: ${{ inputs.sql }} then psql -c "$SQL"', files: { '.github/workflows/u9-env.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: psql -c "$SQL"\n        env:\n          SQL: ${{ inputs.sql }}\n' }, violation: true },
    { id: 'K4 Taskfile psql -c "{{.SQL}}"', files: { 'tools/u9/k4a/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - psql -c \"{{.SQL}}\"\n" }, violation: true },
    { id: 'K4 Taskfile bash -c "{{.CMD}}"', files: { 'tools/u9/k4b/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - bash -c \"{{.CMD}}\"\n" }, violation: true },
    { id: 'K4 Taskfile {{.CMD}} bare', files: { 'tools/u9/k4c/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - '{{.CMD}}'\n" }, violation: true },
    { id: 'K4 Taskfile ogr2ogr PG "{{.DB}}"', files: { 'tools/u9/k4d/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - ogr2ogr -f PostgreSQL \"{{.DB}}\" a.gpkg -nln stage.u9\n" }, violation: true },
    { id: 'K4 Taskfile psql -c "{{ .SQL | default "x" }}" (piped template)', files: { 'tools/u9/k4e/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - psql -c \"{{ .SQL | default \\\"SELECT 1\\\" }}\"\n" }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K4 echo "${{ github.sha }}" (no DB tool, no shell wrapper)', files: { '.github/workflows/u9-k4c1.yml': ci9('echo "${{ github.sha }}"') }, violation: false },
    { id: 'K4 name: ${{ matrix.x }} with run: npm ci', files: { '.github/workflows/u9-k4c2.yml': 'on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - name: ${{ matrix.x }}\n        run: npm ci\n' }, violation: false },
    { id: 'K4 Taskfile echo "{{.NAME}}"', files: { 'tools/u9/k4c3/Taskfile.yml': "version: '3'\ntasks:\n  x:\n    cmds:\n      - echo \"{{.NAME}}\"\n" }, violation: false },
  ];
  caughtAndControls9('K4 (G8-4: Actions ${{ }} and Go templates as commands)', violations, controls, 40);
}

// ---- K5 (G8-5): ssh as a command channel ----
{
  const OPTS = ['', '-p 22 ', '-i ~/.ssh/id_ed25519 ', '-o StrictHostKeyChecking=no ', '-tt ', '-l deploy ', '-J jump ', '-q -o BatchMode=yes '];
  const REMOTE: readonly [string, string][] = [
    ['psql -c "$1"', 'psql -c "$1"'],
    ['"psql -c \\"$1\\"" (quoted command)', '"psql -c \\"$1\\""'],
    ["'psql -c \"TRUNCATE env.sgu_well\"' (static protected)", `'psql -c "${EVIL9_SQL}"'`],
    ['sudo -u postgres psql -c "$SQL"', 'sudo -u postgres psql -c "$SQL"'],
    ['"$CMD" (a remote command from a value)', '"$CMD"'],
    ['bash -s <<EOF psql -c "$1"', 'bash -s <<EOF\npsql -c "$1"\nEOF'],
    ['psql <<EOF $1', 'psql <<EOF\n$1\nEOF'],
    ['<<EOF psql -c "$1" (the remote shell reads stdin)', '<<EOF\npsql -c "$1"\nEOF'],
    ['docker exec db psql -c "$1"', 'docker exec -i db psql -c "$1"'],
    ['pg_restore -d prod -t stage.u9 "$DUMP"', 'pg_restore -d prod -t stage.u9 "$DUMP"'],
    ['-- psql -c "$1" (after --)', '-- psql -c "$1"'],
    ['"cd /srv && psql -c \\"$1\\""', '"cd /srv && psql -c \\"$1\\""'],
  ];
  const violations: Form9[] = [];
  REMOTE.forEach(([rname, remote], r) => {
    OPTS.forEach((opt, o) => {
      if ((r + o) % 2 !== 0) return; // 12 x 8 / 2 = 48 forms
      violations.push({ id: `K5 ssh ${opt}host ${rname}`, files: { [`scripts/u9/k5-${r}-${o}.sh`]: sh9(`ssh ${opt}db-host ${remote}`) }, violation: true });
    });
  });
  violations.push(
    { id: 'K5 H25 ssh host <<EOF psql -c "$1" (verifier)', files: { 'scripts/u9/k5-h25.sh': sh9('ssh db-host <<EOF\npsql -c "$1"\nEOF') }, violation: true },
    { id: 'K5 H26 ssh host psql <<EOF $1 (verifier)', files: { 'scripts/u9/k5-h26.sh': sh9('ssh db-host psql <<EOF\n$1\nEOF') }, violation: true },
    { id: 'K5 Z08 ssh host bash -s <<EOF (verifier)', files: { 'scripts/u9/k5-z08.sh': sh9('ssh db-host bash -s <<EOF\npsql -c "$1"\nEOF') }, violation: true },
    { id: 'K5 Z09 ssh host "psql -c \\"$1\\"" (verifier)', files: { 'scripts/u9/k5-z09.sh': sh9('ssh db-host "psql -c \\"$1\\""') }, violation: true },
    { id: 'K5 ssh in an npm script', files: { 'tools/u9/k5-npm/package.json': npm9({ x: 'ssh db-host "psql -c \\"$npm_config_sql\\""' }) }, violation: true },
    { id: 'K5 ssh in a CI step', files: { '.github/workflows/u9-k5.yml': ci9('ssh db-host psql -c "${{ inputs.sql }}"') }, violation: true },
    { id: 'K5 ssh in a Dockerfile RUN', files: { 'deploy/u9/k5/Dockerfile': 'FROM alpine\nRUN ssh db-host psql -c "$SQL"\n' }, violation: true },
    { id: 'K5 & ssh in PowerShell', files: { 'scripts/u9/k5.ps1': 'param([string]$q)\n& ssh db-host psql -c $q\n' }, violation: true },
    { id: 'K5 JS execSync ssh', files: { 'scripts/u9/k5.mjs': "import { execSync } from 'node:child_process';\nexecSync(`ssh db-host \"psql -c '${process.argv[2]}'\"`);\n" }, violation: true },
    { id: 'K5 Python subprocess ssh list', files: { 'scripts/u9/k5.py': "import subprocess, sys\nsubprocess.run(['ssh', 'db-host', 'psql', '-c', sys.argv[1]])\n" }, violation: true },
    { id: 'K5 ssh "$HOST" psql -c static protected', files: { 'scripts/u9/k5-host.sh': sh9(`ssh "$HOST" psql -c "${EVIL9_SQL}"`) }, violation: true },
    { id: 'K5 ssh host psql -f "$FILE"', files: { 'scripts/u9/k5-file.sh': sh9('ssh db-host psql -f "$FILE"') }, violation: true },
    { id: 'K5 ssh host psql < local.sql (stdin file through the tunnel)', files: { 'scripts/u9/k5-stdin.sh': sh9('ssh db-host psql postgresql://localhost/x < "$LOCAL_SQL"') }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K5 ssh host uptime', files: { 'scripts/u9/k5-c1.sh': sh9('ssh db-host uptime') }, violation: false },
    { id: 'K5 ssh -p 22 host "ls -la /srv"', files: { 'scripts/u9/k5-c2.sh': sh9('ssh -p 22 db-host "ls -la /srv"') }, violation: false },
    { id: 'K5 ssh -V', files: { 'scripts/u9/k5-c3.sh': sh9('ssh -V') }, violation: false },
    { id: "K5 ssh host psql -h localhost -c 'SELECT 1' (a literal read)", files: { 'scripts/u9/k5-c4.sh': sh9("ssh db-host psql -h localhost -c 'SELECT 1'") }, violation: false },
    { id: 'K5 ssh "$HOST" uptime (a value that names the host, not a command)', files: { 'scripts/u9/k5-c5.sh': sh9('ssh "$HOST" uptime') }, violation: false },
  ];
  caughtAndControls9('K5 (G8-5: ssh as a command channel)', violations, controls, 40);
}

// ---- K6 (G8-6 / G8-12): gate and scanner agree -- value programs, unread code runners, several here-documents ----
{
  const violations: Form9[] = [];
  const PROGRAM_VALUES = ['"$PSQL_BIN"', '$PSQL', '"${PSQL_BIN}"', '"$(command -v psql)"', '`which psql`', '${PSQL:-psql}', '"$TOOLS/psql"', '"$HOME/.local/bin/psql"'];
  const ARGS = ['-c "$1"', '-c "SELECT 1"', `-c "${EVIL9_SQL}"`, '-f "$F"', '-f schema.sql', '"$DB" -c "SELECT 1"'];
  PROGRAM_VALUES.forEach((p, i) => ARGS.forEach((a, j) => {
    if ((i + j) % 2 !== 0) return; // 8 x 6 / 2 = 24
    violations.push({ id: `K6 program value ${p} ${a}`, files: { [`scripts/u9/k6-p-${i}-${j}.sh`]: sh9(`${p} ${a}`) }, violation: true });
  }));
  const UNREAD = ['ruby', 'perl', 'php'];
  const CODE: readonly [string, (lang: string) => string][] = [
    ['<<EOF with $1', (l) => `${l} <<EOF\nsystem("psql -c '$1'")\nEOF`],
    ["<<'EOF' static (code no binding reads)", (l) => `${l} <<'EOF'\nsystem("psql -c 'SELECT 1'");\nEOF`],
    ['-e code with $1', (l) => `${l} ${l === 'php' ? '-r' : '-e'} "system('psql -c \\"$1\\"')"`],
    ['-e static code', (l) => `${l} ${l === 'php' ? '-r' : '-e'} 'system("psql -c \\"TRUNCATE env.sgu_well\\"")'`],
    ['script file', (l) => `${l} scripts/u9/k6-script.${l === 'ruby' ? 'rb' : l === 'perl' ? 'pl' : 'php'}`],
    ['<<< "$CODE"', (l) => `${l} <<< "$CODE"`],
  ];
  UNREAD.forEach((l) => CODE.forEach(([cname, render]) => violations.push({ id: `K6 ${l} ${cname}`, files: { [`scripts/u9/k6-${l}-${cname.replace(/[^a-z0-9]+/gi, '-')}.sh`]: bash9(render(l)) }, violation: true })));
  violations.push(
    { id: 'K6 H21 ruby <<EOF with $1 (verifier)', files: { 'scripts/u9/k6-h21.sh': sh9('ruby <<EOF\nsystem("psql -c \'$1\'")\nEOF') }, violation: true },
    { id: "K6 H22 perl <<'EOF' static (verifier, G8-12: an unread language)", files: { 'scripts/u9/k6-h22.sh': sh9("perl <<'EOF'\nsystem(\"psql -c 'SELECT 1'\");\nEOF") }, violation: true },
    { id: 'K6 two here-documents on one line, the second to psql with $1 (H06)', files: { 'scripts/u9/k6-h06.sh': sh9('cat <<A >/dev/null; psql "$DB" <<B\nfirst\nA\n$1\nB') }, violation: true },
    { id: 'K6 two here-documents, the second static protected', files: { 'scripts/u9/k6-two2.sh': sh9(`cat <<A >/dev/null && psql postgresql://localhost/x <<B\nfirst\nA\n${EVIL9_SQL};\nB`) }, violation: true },
    { id: 'K6 three here-documents, the third to bash with a value', files: { 'scripts/u9/k6-three.sh': sh9('cat <<A >/dev/null; cat <<B >/dev/null; bash <<C\na\nA\nb\nB\n$CMD\nC') }, violation: true },
    { id: 'K6 here-document to psql then && echo on the same line', files: { 'scripts/u9/k6-and.sh': sh9('psql postgresql://localhost/x <<EOF && echo done\n$1\nEOF') }, violation: true },
    { id: 'K6 here-document inside a pipeline: cat <<EOF | psql with $1', files: { 'scripts/u9/k6-pipe.sh': sh9('cat <<EOF | psql postgresql://localhost/x\n$1\nEOF') }, violation: true },
    { id: 'K6 ruby in an npm script', files: { 'tools/u9/k6-npm/package.json': npm9({ x: 'ruby -e "system(\'psql -c \\"$npm_config_sql\\"\')"' }) }, violation: true },
    { id: 'K6 perl -pe on stdin from a value (an unread language runs code)', files: { 'scripts/u9/k6-perl-pe.sh': sh9("perl -pe 's/a/b/' <<< \"$INPUT\"") }, violation: true },
    { id: 'K6 php -r in a CI step', files: { '.github/workflows/u9-k6-php.yml': ci9("php -r 'system(getenv(\"CMD\"));'") }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K6 echo ruby perl php (words, not programs)', files: { 'scripts/u9/k6-c1.sh': sh9('echo ruby perl php') }, violation: false },
    { id: 'K6 psql -h localhost -c SELECT after a cat <<EOF >/dev/null on the same line', files: { 'scripts/u9/k6-c2.sh': sh9("cat <<A >/dev/null; psql -h localhost -c 'SELECT 1'\nfirst\nA") }, violation: false },
    { id: 'K6 which psql (a lookup, not a run)', files: { 'scripts/u9/k6-c3.sh': sh9('which psql && echo found') }, violation: false },
  ];
  caughtAndControls9('K6 (G8-6, G8-12: value programs, unread code runners, several here-documents)', violations, controls, 40);
}

// ---- K7 (G8-7, G8-8): package.json fields outside scripts, and the package-manager rc files ----
{
  const HOOK_VALUES: readonly [string, string][] = [
    ['psql -c "$SQL"', 'psql -c "$SQL"'],
    ['bash data file', 'bash scripts/u9/k7-evil.txt'],
    ['static protected psql', `psql -c "${EVIL9_SQL}"`],
    ['node -r ./hook.txt ok', 'node -r ./scripts/u9/k7-hook.txt scripts/u9/k7-ok.mjs'],
    ['tsx of a test source', 'tsx scripts/u9/unit/k7.test.ts'],
  ];
  const FIELDS: readonly [string, (cmd: string) => Record<string, unknown>][] = [
    ['husky.hooks.pre-commit (v4)', (c) => ({ husky: { hooks: { 'pre-commit': c } } })],
    ['husky.hooks.pre-push (v4)', (c) => ({ husky: { hooks: { 'pre-push': c } } })],
    ['lint-staged "*.sql" string', (c) => ({ 'lint-staged': { '*.sql': c } })],
    ['lint-staged "*.ts" array', (c) => ({ 'lint-staged': { '*.ts': ['eslint --fix', c] } })],
    ['simple-git-hooks.pre-commit', (c) => ({ 'simple-git-hooks': { 'pre-commit': c } })],
    ['simple-git-hooks.commit-msg', (c) => ({ 'simple-git-hooks': { 'commit-msg': c } })],
    ['nano-staged "*.sql"', (c) => ({ 'nano-staged': { '*.sql': c } })],
    ['gitHooks.pre-commit (yorkie)', (c) => ({ gitHooks: { 'pre-commit': c } })],
  ];
  const extraFiles = { 'scripts/u9/k7-evil.txt': EVIL9_SH, 'scripts/u9/k7-hook.txt': EVIL9_CJS, 'scripts/u9/k7-ok.mjs': OK9, 'scripts/u9/unit/k7.test.ts': `${PG5}await pool.query('${EVIL9_SQL}');\n` };
  const violations: Form9[] = [];
  FIELDS.forEach(([fname, make], f) => HOOK_VALUES.forEach(([vname, cmd], v) => {
    violations.push({ id: `K7 ${fname} :: ${vname}`, files: { [`tools/u9/k7-${f}-${v}/package.json`]: npm9({ ok: 'echo ok' }, make(cmd)), ...extraFiles }, violation: true });
  }));
  violations.push(
    { id: 'K7 C21 husky hooks with a dynamic psql (verifier)', files: { 'tools/u9/k7-c21/package.json': npm9({}, { husky: { hooks: { 'pre-commit': 'psql -c "$SQL"' } } }) }, violation: true },
    { id: 'K7 C22 lint-staged bash data file (verifier)', files: { 'tools/u9/k7-c22/package.json': npm9({}, { 'lint-staged': { '*.sql': 'bash scripts/u9/k7-evil.txt' } }), 'scripts/u9/k7-evil.txt': EVIL9_SH }, violation: true },
    { id: 'K7 C23 simple-git-hooks (verifier)', files: { 'tools/u9/k7-c23/package.json': npm9({}, { 'simple-git-hooks': { 'pre-commit': 'bash scripts/u9/k7-evil.txt' } }), 'scripts/u9/k7-evil.txt': EVIL9_SH }, violation: true },
    { id: 'K7 B12 bin entry to a data file (node runs it)', files: { 'tools/u9/k7-b12/package.json': npm9({ ok: 'echo ok' }, { bin: { wipe: 'scripts/u9/k7-bin.txt' } }), 'scripts/u9/k7-bin.txt': `#!/usr/bin/env node\n${EVIL9_CJS}` }, violation: true },
    { id: 'K7 bin as a string to a data file', files: { 'tools/u9/k7-bin2/package.json': npm9({ ok: 'echo ok' }, { bin: 'scripts/u9/k7-bin2.txt' }), 'scripts/u9/k7-bin2.txt': EVIL9_CJS }, violation: true },
    { id: 'K7 bin to a missing file (an unresolved launch)', files: { 'tools/u9/k7-bin3/package.json': npm9({ ok: 'echo ok' }, { bin: { wipe: 'scripts/u9/no-such-k7-bin.js' } }) }, violation: true },
    { id: 'K7 config value holding a protected statement (the literal surface)', files: { 'tools/u9/k7-cfg/package.json': npm9({ ok: 'echo ok' }, { config: { sql: EVIL9_SQL } }) }, violation: true },
    { id: 'K7 C20 .npmrc node-options=--require ./h.txt (verifier)', files: { 'tools/u9/k7-c20/.npmrc': 'node-options=--require ./scripts/u9/k7-hook.txt\n', 'tools/u9/k7-c20/package.json': npm9({ x: 'node scripts/u9/k7-ok.mjs' }), 'scripts/u9/k7-hook.txt': EVIL9_CJS, 'scripts/u9/k7-ok.mjs': OK9 }, violation: true },
    { id: 'K7 .npmrc node_options (underscore) --import=./h.json', files: { 'tools/u9/k7-rc2/.npmrc': 'node_options=--import=./scripts/u9/k7-hook.json\n', 'scripts/u9/k7-hook.json': EVIL9_CJS }, violation: true },
    { id: 'K7 .npmrc node-options from a value', files: { 'tools/u9/k7-rc3/.npmrc': 'node-options=${EXTRA_NODE_OPTIONS}\n' }, violation: true },
    { id: 'K7 .npmrc script-shell=<repo data file> (the shell npm runs scripts with)', files: { 'tools/u9/k7-rc4/.npmrc': 'script-shell=scripts/u9/k7-shell.txt\n', 'scripts/u9/k7-shell.txt': `#!/bin/sh\n${EVIL9_SH}` }, violation: true },
    { id: 'K7 .npmrc script-shell to a missing file (unresolved launch)', files: { 'tools/u9/k7-rc5/.npmrc': 'script-shell=/opt/no-such/shell\n' }, violation: true },
    { id: 'K7 .npmrc onload-script=./x.txt (a module npm loads, run as JavaScript)', files: { 'tools/u9/k7-rc6/.npmrc': 'onload-script=./scripts/u9/k7-onload.txt\n', 'scripts/u9/k7-onload.txt': EVIL9_CJS }, violation: true },
    { id: 'K7 .yarnrc.yml yarnPath to a data file', files: { 'tools/u9/k7-rc7/.yarnrc.yml': 'yarnPath: scripts/u9/k7-yarn.txt\n', 'scripts/u9/k7-yarn.txt': EVIL9_CJS }, violation: true },
    { id: 'K7 .yarnrc yarn-path "x.txt" (the yarn release node runs)', files: { 'tools/u9/k7-rc8/.yarnrc': 'yarn-path "scripts/u9/k7-yarn8.txt"\n', 'scripts/u9/k7-yarn8.txt': EVIL9_CJS }, violation: true },
    { id: 'K7 .yarnrc.yml yarnPath to a missing release (unresolved launch)', files: { 'tools/u9/k7-rc9/.yarnrc.yml': 'yarnPath: .yarn/releases/no-such-yarn.cjs\n' }, violation: true },
  );
  const controls: Form9[] = [
    { id: 'K7 lint-staged eslint --fix', files: { 'tools/u9/k7-c1/package.json': npm9({ ok: 'echo ok' }, { 'lint-staged': { '*.ts': 'eslint --fix' } }) }, violation: false },
    { id: 'K7 husky hooks npm test', files: { 'tools/u9/k7-c2/package.json': npm9({ test: 'vitest run' }, { husky: { hooks: { 'pre-commit': 'npm test' } } }) }, violation: false },
    { id: 'K7 config { port: 3000 }', files: { 'tools/u9/k7-c3/package.json': npm9({ ok: 'echo ok' }, { config: { port: '3000' } }) }, violation: false },
    { id: 'K7 .npmrc registry and save-exact', files: { 'tools/u9/k7-c4/.npmrc': 'registry=https://registry.npmjs.org/\nsave-exact=true\n' }, violation: false },
    { id: 'K7 .nvmrc names a version', files: { 'tools/u9/k7-c5/.nvmrc': '22\n' }, violation: false },
    { id: 'K7 bin to a clean repository script', files: { 'tools/u9/k7-c6/package.json': npm9({ ok: 'echo ok' }, { bin: { hello: 'scripts/u9/k7-hello.mjs' } }), 'scripts/u9/k7-hello.mjs': OK9 }, violation: false },
  ];
  caughtAndControls9('K7 (G8-7, G8-8: package.json hook fields, bin, config; .npmrc / .yarnrc launches)', violations, controls, 40);
}

// ---- G8-10 (low): the JSON places and PowerShell forms the delta verifier found unread ----
describe('U30F9 -- G8-10: root .devcontainer.json, nested .vscode, launch.json python/PowerShell, Start-Process -ArgumentList lists', () => {
  it.each([
    ['C05 root .devcontainer.json postCreateCommand bash data', { '.devcontainer.json': `${JSON.stringify({ postCreateCommand: 'bash scripts/u9/g10-p05.txt' })}\n`, 'scripts/u9/g10-p05.txt': EVIL9_SH }],
    ['C07 nested tools/x/.vscode/tasks.json bash + args data file', { 'tools/u9g10/.vscode/tasks.json': `${JSON.stringify({ version: '2.0.0', tasks: [{ label: 'x', type: 'process', command: 'bash', args: ['scripts/u9/g10-p07.txt'] }] })}\n`, 'scripts/u9/g10-p07.txt': EVIL9_SH }],
    ['C11 launch.json debugpy program = data file', { '.vscode/u9g10c11/launch.json': `${JSON.stringify({ configurations: [{ type: 'debugpy', request: 'launch', name: 'x', program: '${workspaceFolder}/scripts/u9/g10-p11.txt' }] })}\n`, 'scripts/u9/g10-p11.txt': "import os, psycopg2\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\n" }],
    ['C11b launch.json python program = data file', { '.vscode/u9g10c11b/launch.json': `${JSON.stringify({ configurations: [{ type: 'python', request: 'launch', name: 'x', program: '${workspaceFolder}/scripts/u9/g10-p11b.txt' }] })}\n`, 'scripts/u9/g10-p11b.txt': "import os, psycopg2\npsycopg2.connect('').cursor().execute(os.environ['SQL'])\n" }],
    ['C12 launch.json PowerShell script = data file', { '.vscode/u9g10c12/launch.json': `${JSON.stringify({ configurations: [{ type: 'PowerShell', request: 'launch', name: 'x', script: '${workspaceFolder}/scripts/u9/g10-p12.txt' }] })}\n`, 'scripts/u9/g10-p12.txt': `psql -c "${EVIL9_SQL}"\n` }],
    ["C18 Start-Process pwsh -ArgumentList '-File', 'x.txt'", { 'scripts/u9/g10-c18.ps1': "Start-Process pwsh -ArgumentList '-File', 'scripts/u9/g10-p18.txt'\n", 'scripts/u9/g10-p18.txt': `psql -c "${EVIL9_SQL}"\n` }],
    ["Start-Process -FilePath pwsh -ArgumentList '-NoProfile', '-File', 'x.txt' -Wait", { 'scripts/u9/g10-c18b.ps1': "Start-Process -FilePath pwsh -ArgumentList '-NoProfile', '-File', 'scripts/u9/g10-p18b.txt' -Wait\n", 'scripts/u9/g10-p18b.txt': `psql -c "${EVIL9_SQL}"\n` }],
    ["Start-Process psql -ArgumentList '-c', $args[0]", { 'scripts/u9/g10-c18c.ps1': "Start-Process psql -ArgumentList '-c', $args[0]\n" }],
  ] as const)('%s -> caught', (_label, files) => {
    expect(problemsOfChange(files).length).toBeGreaterThan(0);
  });

  it.each([
    ['root .devcontainer.json postCreateCommand npm ci', { '.devcontainer.json': `${JSON.stringify({ postCreateCommand: 'npm ci' })}\n` }],
    ['nested .vscode/tasks.json npm run build', { 'tools/u9g10c/.vscode/tasks.json': `${JSON.stringify({ tasks: [{ label: 'b', type: 'shell', command: 'npm', args: ['run', 'build'] }] })}\n` }],
    ["Start-Process pwsh -ArgumentList '-File', 'ok.ps1' of a clean script", { 'scripts/u9/g10-ok.ps1': "Start-Process pwsh -ArgumentList '-File', 'scripts/u9/g10-ok-lib.ps1'\n", 'scripts/u9/g10-ok-lib.ps1': "Write-Host 'ok'\n" }],
  ] as const)('control: %s passes', (_label, files) => {
    expect(problemsOfChange(files)).toEqual([]);
  });
});

// ---- Content pins (G8-9, G8-13): fields, CRLF, and canaries beyond the orchestrators ----
describe('U30F9 -- content pins: every pinned entry is justified, dated and reachable; CRLF pins alike; a change anywhere fails with the re-review procedure (G8-9, G8-13)', () => {
  const pinned = REVIEWED_CHANNELS.filter((e) => e.policy === 'DYNAMIC_REVIEWED');
  const pinMsg = (ps: Problem[]) => ps.filter((p) => p.problem.includes('U30 re-review required'));

  it('every DYNAMIC_REVIEWED entry carries a justification, a reachability statement, a review date and a reviewer besides its content pin', () => {
    expect(pinned.length).toBeGreaterThan(40);
    for (const e of pinned) {
      const x = e as unknown as { contentSha256?: string; reachability?: string; reviewedOn?: string; reviewedBy?: string };
      expect(x.contentSha256, `${e.file}: contentSha256`).toMatch(/^[0-9a-f]{64}$/);
      expect(e.justification.trim().length, `${e.file}: justification`).toBeGreaterThanOrEqual(60);
      expect((x.reachability ?? '').trim().length, `${e.file}: reachability (how the file is reached: npm script, CI, runbook, operator, or shown unreachable)`).toBeGreaterThanOrEqual(30);
      expect(x.reviewedOn, `${e.file}: reviewedOn (ISO date)`).toMatch(/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/);
      expect((x.reviewedBy ?? '').trim().length, `${e.file}: reviewedBy (the unit and agent that reviewed the entry)`).toBeGreaterThanOrEqual(5);
    }
  });

  it('the re-review document exists and names the four steps the pin message demands', () => {
    const doc = fs.readFileSync(path.join(REPO_ROOT, REREVIEW_DOC), 'utf8');
    for (const must of ['contentSha256', 'reviewedOn', 'reviewedBy', 'U30 re-review:', 'CODEOWNER', 'reachability', 'SAMMA commit']) expect(doc, must).toContain(must);
  });

  it('a pin reads CRLF and LF alike: a line-ending-only change of a pinned file never fails (G8-9 a)', () => {
    for (const e of pinned.filter((x) => !x.file.endsWith('package.json'))) {
      const real = realText(e.file);
      expect(pinMsg(problemsOfChange({ [e.file]: real.replace(/\n/g, '\r\n') })), e.file).toEqual([]);
    }
  });

  const beyondOrchestrators = pinned.map((e) => e.file).filter((f) => !/^scripts\/import\/run-/.test(f) && !f.endsWith('package.json'));
  it('the pins cover files far beyond the orchestrators', () => {
    expect(beyondOrchestrators.length).toBeGreaterThan(30);
  });

  it.each(beyondOrchestrators)('G8-13: a code line appended to %s fails with the re-review message that names the document and the file', (file) => {
    const real = realText(file);
    const tail = /\.(ts|mts|cts|js|mjs|cjs)$/.test(file) ? "\nconsole.log('u30f9');\n" : /\.py$/.test(file) ? "\nprint('u30f9')\n" : /\.sql$/.test(file) ? '\nSELECT 1;\n' : /\.(ps1|psm1)$/.test(file) ? "\nWrite-Host 'u30f9'\n" : /\.ya?ml$/.test(file) ? '\n# u30f9\n' : '\necho u30f9\n';
    const problems = pinMsg(problemsOfChange({ [file]: `${real}${tail}` }));
    expect(problems.length, file).toBeGreaterThan(0);
    expect(problems[0]!.problem).toContain(REREVIEW_DOC);
    expect(problems[0]!.problem).toContain(`U30 re-review: ${file}`);
  });

  it('G8-13: package.json -- a changed script body, a new hook field, a new bin and a new config value each fail the pin; a new devDependency does not', () => {
    const j = JSON.parse(realText('package.json')) as Record<string, unknown>;
    const scripts = j.scripts as Record<string, string>;
    const firstScript = Object.keys(scripts)[0]!;
    const variants: Record<string, Record<string, unknown>> = {
      'script body': { ...j, scripts: { ...scripts, [firstScript]: `${scripts[firstScript]} && echo u30f9` } },
      'husky.hooks': { ...j, husky: { hooks: { 'pre-commit': 'echo u30f9' } } },
      'lint-staged': { ...j, 'lint-staged': { '*.ts': 'echo u30f9' } },
      'simple-git-hooks': { ...j, 'simple-git-hooks': { 'pre-commit': 'echo u30f9' } },
      bin: { ...j, bin: { u30f9: 'scripts/u9/u30f9.mjs' } },
      config: { ...j, config: { u30f9: 'x' } },
    };
    for (const [k, v] of Object.entries(variants)) expect(pinMsg(problemsOfChange({ 'package.json': `${JSON.stringify(v, null, 2)}\n` })).length, k).toBeGreaterThan(0);
    const dep = { ...j, devDependencies: { ...((j.devDependencies as Record<string, string>) ?? {}), 'u30f9-pkg': '1.0.0' } };
    expect(pinMsg(problemsOfChange({ 'package.json': `${JSON.stringify(dep, null, 2)}\n` }))).toEqual([]);
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
    // (U30F9 default-deny: a connection from the environment is a value in a psql command and is a violation on its own; the
    // generator's sh channels name a literal connection so that only the SQL decides)
    { id: 'sh-psql', ext: '.sh', multiline: true, quotes: false, render: (s) => `#!/bin/sh\nset -e\npsql postgresql://localhost/mimer -c '${s}'\n` },
    { id: 'sh-heredoc', ext: '.sh', multiline: true, quotes: true, render: (s) => `#!/bin/bash\npsql postgresql://localhost/mimer <<'SQL'\n${s};\nSQL\n` },
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

// ---------------------------------------------------------------------------------------------
// U30F9 EQ-1 (owner decision, round 16): the lookup-only override's dynamic clause (classifyCommandTextGate) and the
// classifier's G6-7 rule ("the program is a value the text does not hold") are not declared interchangeable by
// assumption. This pins the EXACT verdict class the scanner reports for a program that is a value whose substitution
// only looks psql up. Mutation evidence in the U30F9 addendum: (A) the override's dynamic clause weakened, (B) the
// classifier's G6-7 rule removed, (C) both -- each result recorded against these test ids.
// ---------------------------------------------------------------------------------------------
describe('U30F9 EQ-1: a program that is a value, whose substitution only looks psql up, is UNRESOLVABLE (COMMAND) -- exact class pinned', () => {
  const INPUTS: readonly (readonly [string, string])[] = [
    ['eq1-which-static-read', '"$(which psql)" -c "SELECT 1"'],
    ['eq1-command-v-positional', '"$(command -v psql)" -c "$1"'],
  ];
  // The exact class: UNRESOLVABLE from the gate's verdict -- COMMAND (G6-7: the program is a value) and PSQL_STDIN (the
  // looked-up word `psql` inside the substitution is analysed as a bare psql reading stdin, the G8-11 over-closure class).
  // A weakened override returns ALLOWED for the text and the site falls to the scanner's DYNAMIC program rule instead:
  // another verdict class, so this test fails -- the clause is NOT interchangeable with G6-7.
  it.each(INPUTS)('%s: exactly one site, verdict UNRESOLVABLE, detail "COMMAND, PSQL_STDIN" (G6-7: the program is a value), and the change is a problem', (id, line) => {
    const file = `scripts/u9/${id}.sh`;
    const sites = scanFile(file, sh9(line)).sites;
    expect(sites.map((s) => `${s.verdict}|${s.kind}|${s.detail}`), id).toEqual(['UNRESOLVABLE|PROCESS|COMMAND, PSQL_STDIN']);
    expect(problemsOfChange({ [file]: sh9(line) }).length, id).toBeGreaterThan(0);
  });

  it('control: a lookup alone (which psql && echo found) yields no site', () => {
    expect(scanFile('scripts/u9/eq1-control.sh', sh9('which psql && echo found')).sites).toEqual([]);
  });
});
