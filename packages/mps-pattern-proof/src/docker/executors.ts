/**
 * PATTERN-PROOF-ENGINE-01 V1 -- stage-prefix probe executors (grounding report sections 4-5, plan T1/T10).
 *
 * Two fidelities of the same probe:
 *   - `docker-stage-prefix`: a real `docker build` of the rendered prefix Dockerfile against a
 *     context that holds exactly the prefix's context sources (+ the optional CA bundle prelude input).
 *   - `host-npm`: the prefix's context laid out in a temp dir and the derived install command run with
 *     `/bin/sh -c` on the host (reduced fidelity, recorded as such). It refuses BEFORE spawning, with a
 *     BLOCKED-classifiable execution (`spawnError.code`), a prefix it cannot reproduce faithfully
 *     (any `COPY/ADD --from`, or an install command with an unexpanded `$`: HOST_FIDELITY_UNSUPPORTED,
 *     R1 F8) and a context in which package.json did not land in the host root (CONTEXT_INCOMPLETE,
 *     R1 F2). ARG defaults are applied as environment defaults (docker semantics: args, then ENV,
 *     then the caller's env).
 * Both return a RawProbeExecution whose merged output is classified by ./classify.ts. Neither tags
 * images, starts a daemon or writes outside os.tmpdir().
 *
 * .dockerignore support is a simple matcher (exact names/paths, directory prefixes, `*`/`?`/`**`
 * globs, `!` negation with last-match-wins); character classes are not supported.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProbeSpawnError } from './classify';
import { execFormTokens, instructionShellText, type ParsedInstruction } from './dockerfile-parse';
import { renderStagePrefixDockerfile, type StageContextCopy, type StagePrefix } from './stage-prefix';

export type ProbeFidelity = 'host-npm' | 'docker-stage-prefix';

export interface ProbeToolchain {
  readonly node: string;
  readonly npm: string;
  readonly platform: string;
  readonly dockerClient?: string;
  readonly dockerServer?: string;
  readonly baseImage?: string;
  /** resolved digest of the base image as printed by BuildKit (`@sha256:...`) */
  readonly baseImageDigest?: string;
}

export interface RawProbeExecution {
  /** stdout+stderr merged, in arrival order */
  readonly output: string;
  readonly exitStatus: number | null;
  readonly timedOut: boolean;
  readonly spawnError?: ProbeSpawnError;
  readonly fidelity: ProbeFidelity;
  readonly installStepStarted: boolean;
  readonly toolchain: ProbeToolchain;
  /** context files materialized (relative paths, sorted) */
  readonly contextFiles: readonly string[];
  /** ISO timestamp */
  readonly startedAt: string;
  readonly elapsedMs: number;
  /** the directory the install command effectively ran in (in-image WORKDIR or host temp dir) */
  readonly workdir: string;
  readonly derivedDockerfile?: string;
}

export interface HostProbeOptions {
  readonly repoRoot: string;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface DockerProbeOptions {
  readonly repoRoot: string;
  readonly timeoutMs: number;
  /** path of a CA bundle to inject through the prelude (from env PPE_DOCKER_CA_BUNDLE) */
  readonly caBundlePath?: string;
  /** only set DOCKER_HOST for the docker CLI when given; otherwise the CLI's own env applies */
  readonly dockerHost?: string;
  /** `docker build --network`, default host */
  readonly network?: string;
}

export const CA_BUNDLE_CONTEXT_FILE_NAME = 'ppe-ca-bundle.crt';
export const PROBE_DOCKERFILE_NAME = 'Dockerfile.probe';
const DOCKER_SIGKILL_GRACE_MS = 5000;

// ---------------------------------------------------------------------------------------------
// .dockerignore
// ---------------------------------------------------------------------------------------------

export interface DockerignoreRule {
  readonly negate: boolean;
  readonly pattern: string;
  readonly regex: RegExp;
}

function dockerignoreGlobToRegExp(pattern: string): RegExp {
  let source = '';
  for (let k = 0; k < pattern.length; k += 1) {
    const ch = pattern[k];
    if (ch === '*') {
      if (pattern[k + 1] === '*') {
        k += 1;
        if (pattern[k + 1] === '/') k += 1;
        source += '(?:.*/)?';
        continue;
      }
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export function parseDockerignore(text: string): readonly DockerignoreRule[] {
  const rules: DockerignoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    const pattern = (negate ? line.slice(1) : line).replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '');
    if (pattern === '') continue;
    rules.push(Object.freeze({ negate, pattern, regex: dockerignoreGlobToRegExp(pattern) }));
  }
  return Object.freeze(rules);
}

/** True when `relativePath` (posix, context-relative) or one of its ancestor directories is ignored. */
export function isDockerignored(rules: readonly DockerignoreRule[], relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === '' || normalized === '.') return false;
  const segments = normalized.split('/');
  let ignored = false;
  for (const rule of rules) {
    let hit = false;
    for (let depth = 1; depth <= segments.length; depth += 1) {
      if (rule.regex.test(segments.slice(0, depth).join('/'))) {
        hit = true;
        break;
      }
    }
    if (hit) ignored = !rule.negate;
  }
  return ignored;
}

export function loadDockerignore(repoRoot: string): readonly DockerignoreRule[] {
  const file = path.join(repoRoot, '.dockerignore');
  if (!fs.existsSync(file)) return Object.freeze([]);
  return parseDockerignore(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// context materialization
// ---------------------------------------------------------------------------------------------

const GLOB_CHARS = /[*?]/;

function expandSegments(
  root: string,
  dir: string,
  segments: readonly string[],
  index: number,
  out: string[],
): void {
  if (index >= segments.length) {
    out.push(dir);
    return;
  }
  const segment = segments[index];
  if (!GLOB_CHARS.test(segment)) {
    const next = dir === '' ? segment : `${dir}/${segment}`;
    if (fs.existsSync(path.join(root, next))) expandSegments(root, next, segments, index + 1, out);
    return;
  }
  const absoluteDir = path.join(root, dir);
  if (!fs.existsSync(absoluteDir) || !fs.statSync(absoluteDir).isDirectory()) return;
  const regex = dockerignoreGlobToRegExp(segment);
  for (const entry of fs.readdirSync(absoluteDir).sort()) {
    if (!regex.test(entry)) continue;
    expandSegments(root, dir === '' ? entry : `${dir}/${entry}`, segments, index + 1, out);
  }
}

/** Expands one COPY/ADD source against the context root (honoring .dockerignore). '' means the root. */
export function expandContextSource(
  repoRoot: string,
  source: string,
  rules: readonly DockerignoreRule[],
): readonly string[] {
  const clean = source
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+$/, '');
  if (clean === '' || clean === '.') return Object.freeze(['']);
  const out: string[] = [];
  expandSegments(repoRoot, '', clean.split('/'), 0, out);
  return Object.freeze(out.filter((relative) => !isDockerignored(rules, relative)));
}

function listFiles(root: string, dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) listFiles(root, relative, out);
    else out.push(relative);
  }
}

function copyEntry(
  sourceAbsolute: string,
  destAbsolute: string,
  rules: readonly DockerignoreRule[],
  repoRoot: string,
): void {
  fs.mkdirSync(path.dirname(destAbsolute), { recursive: true });
  fs.cpSync(sourceAbsolute, destAbsolute, {
    recursive: true,
    filter: (candidate) => !isDockerignored(rules, path.relative(repoRoot, candidate)),
  });
}

/** Docker-context layout: every expanded source at its own context-relative path. */
export function materializeDockerContext(
  prefix: StagePrefix,
  repoRoot: string,
  contextDir: string,
  rules: readonly DockerignoreRule[] = loadDockerignore(repoRoot),
): readonly string[] {
  for (const source of prefix.contextSources) {
    for (const relative of expandContextSource(repoRoot, source, rules)) {
      if (relative === '') {
        for (const entry of fs.readdirSync(repoRoot)) {
          if (isDockerignored(rules, entry)) continue;
          copyEntry(path.join(repoRoot, entry), path.join(contextDir, entry), rules, repoRoot);
        }
        continue;
      }
      copyEntry(path.join(repoRoot, relative), path.join(contextDir, relative), rules, repoRoot);
    }
  }
  const files: string[] = [];
  listFiles(contextDir, '', files);
  return Object.freeze(files.sort());
}

function hostDestination(workdir: string, resolvedDest: string): string {
  const base = workdir.endsWith('/') ? workdir : `${workdir}/`;
  if (resolvedDest === workdir) return '';
  if (resolvedDest.startsWith(base)) return resolvedDest.slice(base.length);
  return resolvedDest.replace(/^\/+/, '');
}

/**
 * Host layout: applies Docker COPY semantics (a directory's contents land in dest; a file lands in
 * dest/<basename> when dest is a directory) relative to the temp dir standing in for the WORKDIR.
 */
export function materializeHostLayout(
  copies: readonly StageContextCopy[],
  workdir: string,
  repoRoot: string,
  hostRoot: string,
  rules: readonly DockerignoreRule[] = loadDockerignore(repoRoot),
): readonly string[] {
  for (const copy of copies) {
    const destRelative = hostDestination(workdir, copy.resolvedDest);
    const destAbsolute = path.join(hostRoot, destRelative);
    const matches = copy.sources.flatMap((source) => [...expandContextSource(repoRoot, source, rules)]);
    const destIsDirectory =
      copy.dest.endsWith('/') ||
      copy.dest === '.' ||
      matches.length !== 1 ||
      matches[0] === '' ||
      fs.statSync(path.join(repoRoot, matches[0])).isDirectory();
    for (const relative of matches) {
      const sourceAbsolute = relative === '' ? repoRoot : path.join(repoRoot, relative);
      if (relative === '' || fs.statSync(sourceAbsolute).isDirectory()) {
        for (const entry of fs.readdirSync(sourceAbsolute)) {
          const entryRelative = relative === '' ? entry : `${relative}/${entry}`;
          if (isDockerignored(rules, entryRelative)) continue;
          copyEntry(path.join(repoRoot, entryRelative), path.join(destAbsolute, entry), rules, repoRoot);
        }
      } else {
        const target = destIsDirectory ? path.join(destAbsolute, path.basename(relative)) : destAbsolute;
        copyEntry(sourceAbsolute, target, rules, repoRoot);
      }
    }
  }
  const files: string[] = [];
  listFiles(hostRoot, '', files);
  return Object.freeze(files.sort());
}

// ---------------------------------------------------------------------------------------------
// spawning
// ---------------------------------------------------------------------------------------------

interface SpawnCollectResult {
  readonly output: string;
  readonly exitStatus: number | null;
  readonly timedOut: boolean;
  readonly spawnError?: ProbeSpawnError;
}

interface SpawnCollectOptions {
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly detached: boolean;
  readonly onTimeout: (child: ChildProcess) => void;
}

function serializeError(error: unknown): ProbeSpawnError {
  const err = error as { code?: unknown; message?: unknown };
  const message = typeof err?.message === 'string' ? err.message : String(error);
  return typeof err?.code === 'string' ? { code: err.code, message } : { message };
}

function spawnCollect(
  command: string,
  args: readonly string[],
  options: SpawnCollectOptions,
): Promise<SpawnCollectResult> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let timedOut = false;
    let settled = false;
    let spawnError: ProbeSpawnError | undefined;
    let child: ChildProcess;
    const finish = (exitStatus: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result: {
        output: string;
        exitStatus: number | null;
        timedOut: boolean;
        spawnError?: ProbeSpawnError;
      } = {
        output: chunks.join(''),
        exitStatus,
        timedOut,
      };
      if (spawnError !== undefined) result.spawnError = spawnError;
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      options.onTimeout(child);
    }, options.timeoutMs);
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env,
        detached: options.detached,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnError = serializeError(error);
      finish(null);
      return;
    }
    child.stdout?.on('data', (data: Buffer | string) => chunks.push(String(data)));
    child.stderr?.on('data', (data: Buffer | string) => chunks.push(String(data)));
    child.on('error', (error) => {
      spawnError = serializeError(error);
      setImmediate(() => finish(null));
    });
    child.on('close', (code) => finish(code));
  });
}

function killProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function interruptThenKill(child: ChildProcess): void {
  child.kill('SIGINT');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, DOCKER_SIGKILL_GRACE_MS);
  timer.unref();
}

function versionOf(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const result = spawnSync(command, [...args], { encoding: 'utf8', env, timeout: 20_000 });
  if (result.error !== undefined || result.status !== 0) return undefined;
  const text = result.stdout.trim();
  return text.length > 0 ? text : undefined;
}

function hostToolchain(): { node: string; npm: string; platform: string } {
  return {
    node: process.version,
    npm: versionOf('npm', ['--version']) ?? 'unknown',
    platform: `${process.platform} ${process.arch} ${os.release()}`,
  };
}

/** `docker info --format {{.ServerVersion}}` without a shell; never starts a daemon. */
export async function dockerAvailable(dockerHost?: string): Promise<{ ok: boolean; reason?: string }> {
  const env = dockerEnv(dockerHost);
  const result = await spawnCollect('docker', ['info', '--format', '{{.ServerVersion}}'], {
    env,
    timeoutMs: 30_000,
    detached: false,
    onTimeout: (child) => child.kill('SIGKILL'),
  });
  if (result.spawnError !== undefined) return { ok: false, reason: result.spawnError.message };
  if (result.timedOut) return { ok: false, reason: 'docker info timed out' };
  if (result.exitStatus !== 0) {
    const reason =
      result.output
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .pop() ?? 'docker info failed';
    return { ok: false, reason };
  }
  return { ok: true };
}

function dockerEnv(dockerHost?: string): NodeJS.ProcessEnv {
  return dockerHost === undefined ? { ...process.env } : { ...process.env, DOCKER_HOST: dockerHost };
}

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The step-header texts BuildKit may print for an install RUN: the shell text (shell form, or the
 * exec tokens joined) and, for an exec-form RUN, the raw JSON array text as written plus its
 * canonical `["a", "b"]` re-serialization (R1 F7: BuildKit prints `RUN ["node", "-e", "1"]`).
 */
export function installStepHeaders(installCommand: string, instruction?: ParsedInstruction): string[] {
  const headers = [normalizeSpaces(installCommand)];
  if (instruction !== undefined) {
    headers.push(normalizeSpaces(instructionShellText(instruction)));
    const tokens = execFormTokens(instruction.args);
    if (tokens !== null) {
      headers.push(normalizeSpaces(instruction.args));
      headers.push(`[${tokens.map((token) => JSON.stringify(token)).join(', ')}]`);
    }
  }
  return [...new Set(headers.filter((header) => header.length > 0))];
}

/**
 * True when the BuildKit plain-progress step header for the install RUN appears in the output:
 * the normalized header text must EQUAL one of `installStepHeaders` (R2 F7: no prefix rule, so an
 * ancestor stage's shorter `RUN npm ci` never marks the target's `npm ci --omit=dev ...` as started).
 */
export function dockerInstallStepStarted(
  output: string,
  installCommand: string,
  instruction?: ParsedInstruction,
): boolean {
  const wantedHeaders = installStepHeaders(installCommand, instruction);
  for (const line of output.split(/\r?\n/)) {
    const match = /^#\d+ \[[^\]]*\] RUN (.*)$/.exec(line);
    if (match === null) continue;
    const header = normalizeSpaces(match[1]);
    if (header.length === 0) continue;
    if (wantedHeaders.some((wanted) => header === wanted)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// executors
// ---------------------------------------------------------------------------------------------

function buildExecution(
  base: SpawnCollectResult,
  fields: {
    fidelity: ProbeFidelity;
    installStepStarted: boolean;
    toolchain: ProbeToolchain;
    contextFiles: readonly string[];
    startedAt: string;
    elapsedMs: number;
    workdir: string;
    derivedDockerfile?: string;
  },
): RawProbeExecution {
  const execution: {
    output: string;
    exitStatus: number | null;
    timedOut: boolean;
    spawnError?: ProbeSpawnError;
    fidelity: ProbeFidelity;
    installStepStarted: boolean;
    toolchain: ProbeToolchain;
    contextFiles: readonly string[];
    startedAt: string;
    elapsedMs: number;
    workdir: string;
    derivedDockerfile?: string;
  } = {
    output: base.output,
    exitStatus: base.exitStatus,
    timedOut: base.timedOut,
    fidelity: fields.fidelity,
    installStepStarted: fields.installStepStarted,
    toolchain: Object.freeze({ ...fields.toolchain }),
    contextFiles: Object.freeze([...fields.contextFiles]),
    startedAt: fields.startedAt,
    elapsedMs: fields.elapsedMs,
    workdir: fields.workdir,
  };
  if (base.spawnError !== undefined) execution.spawnError = Object.freeze({ ...base.spawnError });
  if (fields.derivedDockerfile !== undefined) execution.derivedDockerfile = fields.derivedDockerfile;
  return Object.freeze(execution);
}

export const HOST_FIDELITY_UNSUPPORTED_CODE = 'HOST_FIDELITY_UNSUPPORTED';
export const CONTEXT_INCOMPLETE_CODE = 'CONTEXT_INCOMPLETE';

/**
 * Why the host executor cannot reproduce this prefix faithfully (R1 F8), or undefined when it can:
 * a `COPY/ADD --from` (its sources are another stage's filesystem) or an install command with an
 * unexpanded `$` (no ARG/ENV substitution is performed; docker would expand it).
 */
export function hostFidelityLimitation(prefix: StagePrefix): string | undefined {
  const fromCopy = prefix.instructions.find(
    (instruction) =>
      (instruction.keyword === 'COPY' || instruction.keyword === 'ADD') &&
      instruction.flags.from !== undefined,
  );
  if (fromCopy !== undefined) {
    return `${fromCopy.keyword} --from=${fromCopy.flags.from} at line ${fromCopy.line} cannot be laid out on the host`;
  }
  if (prefix.installCommand.includes('$')) {
    return `install command "${prefix.installCommand}" carries an unexpanded $ substitution`;
  }
  return undefined;
}

function refusedExecution(
  fidelity: ProbeFidelity,
  code: string,
  message: string,
  toolchain: ProbeToolchain,
  contextFiles: readonly string[],
  startedAt: string,
  started: number,
  workdir: string,
): RawProbeExecution {
  return buildExecution(
    { output: '', exitStatus: null, timedOut: false, spawnError: { code, message } },
    {
      fidelity,
      installStepStarted: false,
      toolchain,
      contextFiles,
      startedAt,
      elapsedMs: Date.now() - started,
      workdir,
    },
  );
}

/** ARG defaults (docker semantics: an ARG without a value does not override the environment). */
function argDefaults(prefix: StagePrefix): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(prefix.args)) {
    if (value.length > 0) out[key] = value;
  }
  return out;
}

/**
 * host-npm fidelity: context laid out in a temp dir, install command via `/bin/sh -c`, whole process
 * group SIGKILLed on timeout (npm ignores SIGTERM). The npm cache of $HOME is shared (recorded input).
 * Refuses before spawning (BLOCKED-classifiable, installStepStarted false) when the prefix exceeds
 * host fidelity (R1 F8) or package.json did not land in the host root (R1 F2).
 */
export async function runHostStagePrefixProbe(
  prefix: StagePrefix,
  opts: HostProbeOptions,
): Promise<RawProbeExecution> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const limitation = hostFidelityLimitation(prefix);
  if (limitation !== undefined) {
    return refusedExecution(
      'host-npm',
      HOST_FIDELITY_UNSUPPORTED_CODE,
      `host executor cannot reproduce the prefix: ${limitation}`,
      hostToolchain(),
      [],
      startedAt,
      started,
      '',
    );
  }
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-host-probe-'));
  try {
    const contextFiles = materializeHostLayout(prefix.contextCopies, prefix.workdir, opts.repoRoot, hostRoot);
    if (!fs.existsSync(path.join(hostRoot, 'package.json'))) {
      return refusedExecution(
        'host-npm',
        CONTEXT_INCOMPLETE_CODE,
        `package.json did not land in the host root (WORKDIR ${prefix.workdir}) from context sources [${prefix.contextSources.join(', ')}]`,
        hostToolchain(),
        contextFiles,
        startedAt,
        started,
        hostRoot,
      );
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...argDefaults(prefix),
      ...prefix.env,
      ...(opts.env ?? {}),
    };
    const result = await spawnCollect('/bin/sh', ['-c', prefix.installCommand], {
      cwd: hostRoot,
      env,
      timeoutMs: opts.timeoutMs,
      detached: true,
      onTimeout: killProcessGroup,
    });
    return buildExecution(result, {
      fidelity: 'host-npm',
      installStepStarted: true,
      toolchain: hostToolchain(),
      contextFiles,
      startedAt,
      elapsedMs: Date.now() - started,
      workdir: hostRoot,
    });
  } finally {
    fs.rmSync(hostRoot, { recursive: true, force: true });
  }
}

/**
 * docker-stage-prefix fidelity: `docker build --network <network> --progress plain --no-cache
 * -f Dockerfile.probe <ctx>`; SIGINT then SIGKILL after 5s on timeout; never tags an image.
 */
export async function runDockerStagePrefixProbe(
  prefix: StagePrefix,
  opts: DockerProbeOptions,
): Promise<RawProbeExecution> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const network = opts.network ?? 'host';
  const env = dockerEnv(opts.dockerHost);
  const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppe-docker-probe-'));
  try {
    let contextFiles = materializeDockerContext(prefix, opts.repoRoot, contextDir);
    let caBundleFileName: string | undefined;
    if (opts.caBundlePath !== undefined) {
      fs.copyFileSync(opts.caBundlePath, path.join(contextDir, CA_BUNDLE_CONTEXT_FILE_NAME));
      caBundleFileName = CA_BUNDLE_CONTEXT_FILE_NAME;
      contextFiles = Object.freeze([...contextFiles, CA_BUNDLE_CONTEXT_FILE_NAME].sort());
    }
    const derivedDockerfile = renderStagePrefixDockerfile(
      prefix,
      caBundleFileName === undefined ? {} : { caBundleFileName },
    );
    fs.writeFileSync(path.join(contextDir, PROBE_DOCKERFILE_NAME), derivedDockerfile);
    const result = await spawnCollect(
      'docker',
      [
        'build',
        '--network',
        network,
        '--progress',
        'plain',
        '--no-cache',
        '-f',
        PROBE_DOCKERFILE_NAME,
        contextDir,
      ],
      { cwd: contextDir, env, timeoutMs: opts.timeoutMs, detached: false, onTimeout: interruptThenKill },
    );
    const digestMatch = /FROM [^\s]*@(sha256:[0-9a-f]{64})/.exec(result.output);
    const toolchain: {
      node: string;
      npm: string;
      platform: string;
      dockerClient?: string;
      dockerServer?: string;
      baseImage: string;
      baseImageDigest?: string;
    } = { ...hostToolchain(), baseImage: prefix.baseImage };
    const dockerClient = versionOf('docker', ['version', '--format', '{{.Client.Version}}'], env);
    const dockerServer = versionOf('docker', ['version', '--format', '{{.Server.Version}}'], env);
    if (dockerClient !== undefined) toolchain.dockerClient = dockerClient;
    if (dockerServer !== undefined) toolchain.dockerServer = dockerServer;
    if (digestMatch !== null) toolchain.baseImageDigest = digestMatch[1];
    return buildExecution(result, {
      fidelity: 'docker-stage-prefix',
      installStepStarted: dockerInstallStepStarted(
        result.output,
        prefix.installCommand,
        prefix.installInstruction,
      ),
      toolchain,
      contextFiles,
      startedAt,
      elapsedMs: Date.now() - started,
      workdir: prefix.workdir,
      derivedDockerfile,
    });
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
}
