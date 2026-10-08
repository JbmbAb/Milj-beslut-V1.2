import { deriveEntrypointSetSha256, entrypointsFileJcsSha256, bytesSha256 } from './entrypointSet';
import { parseDockerfileLaunchers, parsePackageScripts, parseSmokeEntrypoints, resolveArgvToEntryFile } from './launchers';
import { parseEntrypointsFile } from './schema';
import { LIBRARY_FILES, detectSelfStarting } from './selfStarting';
import { ENTRYPOINTS_FILE_PATH } from './types';
import type { EntrypointEntry, EntrypointsFile, Problem, TreeReader } from './types';

/** The files the release composition binds that start processes (besides the entrypoints file itself). */
export const DOCKERFILE_PATH = 'Dockerfile';
export const PACKAGE_JSON_PATH = 'package.json';
export const SMOKE_PATH = 'deploy/onprem/image-smoke/smoke.mjs';
export const WORKERS_DIRECTORY = 'server/workers';
export const WEB_ENTRY_FILE = 'server/index.ts';

const CODE_FILE = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

export interface LaunchedBy {
  readonly id: string;
  readonly sources: readonly string[];
}

export type CompositionCheck =
  | {
      readonly outcome: 'consistent';
      readonly file: EntrypointsFile;
      readonly derived_sha256: string;
      readonly file_jcs_sha256: string;
      readonly file_bytes_sha256: string;
      readonly launched_by: readonly LaunchedBy[];
    }
  | { readonly outcome: 'not_executed'; readonly problems: readonly Problem[] };

/**
 * Checks the entrypoint composition of ONE tree against the files that tree binds. Any problem at all gives
 * `not_executed`: there is no partial set and no pass with warnings.
 *
 *  schema                      closed keys, sorted, no duplicates (schema.ts)
 *  cmd-resolves                every Dockerfile CMD/ENTRYPOINT resolves (through package.json scripts) to a file in entries or not_production
 *  entry-launched              every entry is launched by a bound source (Dockerfile CMD, smoke ENTRYPOINTS, a package script)
 *  argv-resolves               every entry's own argv resolves to its entry_file
 *  self-starting-listed        every self-starting file under server/workers and server/index.ts is in entries or not_production;
 *                              the explicit library files are confirmed not self-starting
 *  lists-disjoint-and-exist    no file in both lists; every listed file exists in the tree
 */
export function checkEntrypointComposition(tree: TreeReader): CompositionCheck {
  const problems: Problem[] = [];

  const raw = tree.read(ENTRYPOINTS_FILE_PATH);
  if (raw === null) return { outcome: 'not_executed', problems: [{ rule: 'schema', message: `${ENTRYPOINTS_FILE_PATH} is not in the tree` }] };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { outcome: 'not_executed', problems: [{ rule: 'schema', message: `${ENTRYPOINTS_FILE_PATH} is not valid JSON` }] };
  }
  const parsed = parseEntrypointsFile(json);
  if (!parsed.ok) return { outcome: 'not_executed', problems: parsed.problems };
  const file = parsed.file;

  const entryFiles = new Set(file.entries.map((e) => e.entry_file));
  const notProductionFiles = new Set(file.not_production.map((n) => n.entry_file));
  const listed = new Set([...entryFiles, ...notProductionFiles]);

  // bound sources
  const dockerText = tree.read(DOCKERFILE_PATH);
  const packageText = tree.read(PACKAGE_JSON_PATH);
  const smokeText = tree.read(SMOKE_PATH);
  if (dockerText === null) problems.push({ rule: 'cmd-resolves', message: `${DOCKERFILE_PATH} is not in the tree` });
  if (packageText === null) problems.push({ rule: 'cmd-resolves', message: `${PACKAGE_JSON_PATH} is not in the tree` });
  if (smokeText === null) problems.push({ rule: 'entry-launched', message: `${SMOKE_PATH} is not in the tree` });
  if (dockerText === null || packageText === null || smokeText === null) return { outcome: 'not_executed', problems };

  const scriptsResult = parsePackageScripts(packageText);
  const dockerResult = parseDockerfileLaunchers(dockerText);
  const smokeResult = parseSmokeEntrypoints(smokeText);
  if (!scriptsResult.ok) problems.push({ rule: 'cmd-resolves', message: scriptsResult.message });
  if (!dockerResult.ok) problems.push({ rule: 'cmd-resolves', message: dockerResult.message });
  if (!smokeResult.ok) problems.push({ rule: 'entry-launched', message: smokeResult.message });
  if (!scriptsResult.ok || !dockerResult.ok || !smokeResult.ok) return { outcome: 'not_executed', problems };
  const scripts = scriptsResult.value;

  // A compose file bound by the composition (under deploy/onprem/) would start processes through `command:` lines this
  // checker does not read; fail closed rather than ignore it. (None exists on the release line today.)
  for (const f of tree.listUnder('deploy/onprem')) {
    if (/compose[^/]*\.ya?ml$/i.test(f)) problems.push({ rule: 'cmd-resolves', message: `${f} is a compose file bound by the composition; its command lines are not checked here, so the composition cannot be established` });
  }

  // (1) every Dockerfile launcher resolves to a listed file
  const dockerTargets: Array<{ file: string; where: string }> = [];
  for (const launcher of dockerResult.value) {
    const resolved = resolveArgvToEntryFile(launcher.argv, scripts);
    const where = `Dockerfile line ${launcher.line} (${launcher.instruction})`;
    if (!resolved.ok) {
      problems.push({ rule: 'cmd-resolves', message: `${where} does not resolve to a file: ${resolved.message}` });
      continue;
    }
    dockerTargets.push({ file: resolved.value, where });
    if (!listed.has(resolved.value)) problems.push({ rule: 'cmd-resolves', message: `${where} runs ${resolved.value}, which is in neither entries nor not_production` });
  }

  // (2) every entry is launched by a bound source; (5) its own argv resolves to its entry_file
  const launchedBy: LaunchedBy[] = [];
  for (const entry of file.entries) {
    const sources: string[] = [];
    for (const t of dockerTargets) if (t.file === entry.entry_file) sources.push(t.where);
    if (smokeResult.value.includes(entry.entry_file)) sources.push(`${SMOKE_PATH} ENTRYPOINTS`);
    for (const name of Object.keys(scripts).sort()) {
      const r = resolveArgvToEntryFile(['npm', 'run', name], scripts);
      if (r.ok && r.value === entry.entry_file) sources.push(`${PACKAGE_JSON_PATH} script ${name}`);
    }
    launchedBy.push({ id: entry.id, sources: [...new Set(sources)] });
    if (sources.length === 0) problems.push({ rule: 'entry-launched', message: `entry ${entry.id} (${entry.entry_file}) is launched by no Dockerfile CMD, no smoke ENTRYPOINTS item and no package script` });
    const own = resolveArgvToEntryFile(entry.argv, scripts);
    if (!own.ok) problems.push({ rule: 'argv-resolves', message: `entry ${entry.id}: argv does not resolve to a file: ${own.message}` });
    else if (own.value !== entry.entry_file) problems.push({ rule: 'argv-resolves', message: `entry ${entry.id}: argv runs ${own.value}, not ${entry.entry_file}` });
  }

  // (3) every self-starting process file is listed; the library files are confirmed
  const processFiles = [...new Set([WEB_ENTRY_FILE, ...tree.listUnder(WORKERS_DIRECTORY).filter((f) => CODE_FILE.test(f))])].sort();
  for (const f of processFiles) {
    const text = tree.read(f);
    if (text === null) {
      problems.push({ rule: 'self-starting-listed', message: `${f} cannot be read from the tree` });
      continue;
    }
    const verdict = detectSelfStarting(text);
    const isLibrary = Object.prototype.hasOwnProperty.call(LIBRARY_FILES, f);
    if (isLibrary) {
      if (verdict.selfStarting) problems.push({ rule: 'self-starting-listed', message: `${f} is declared a library but has a top-level start marker (${verdict.markers.map((m) => `${m.name}@${m.line}`).join(', ')})` });
      if (listed.has(f)) problems.push({ rule: 'lists-disjoint-and-exist', message: `${f} is a library file and must not be listed as an entry or as not_production` });
      continue;
    }
    if (verdict.selfStarting && !listed.has(f)) {
      problems.push({ rule: 'self-starting-listed', message: `${f} is self-starting (${verdict.markers.map((m) => `${m.name}@${m.line}`).join(', ')}) and is in neither entries nor not_production` });
    }
  }
  for (const lib of Object.keys(LIBRARY_FILES)) {
    if (!tree.has(lib)) problems.push({ rule: 'self-starting-listed', message: `library file ${lib} is not in the tree (the library table is stale)` });
  }

  // (4) every listed file exists
  for (const f of [...listed].sort()) {
    if (!tree.has(f)) problems.push({ rule: 'lists-disjoint-and-exist', message: `${f} is listed but is not a file of the tree` });
  }

  if (problems.length > 0) return { outcome: 'not_executed', problems };
  return {
    outcome: 'consistent',
    file,
    derived_sha256: deriveEntrypointSetSha256(file.entries as readonly EntrypointEntry[]),
    file_jcs_sha256: entrypointsFileJcsSha256(json),
    file_bytes_sha256: bytesSha256(raw),
    launched_by: launchedBy,
  };
}
