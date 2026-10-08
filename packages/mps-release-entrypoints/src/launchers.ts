/**
 * The "bound sources" of the release composition that start processes, parsed textually and conservatively:
 *  - the Dockerfile (CMD and ENTRYPOINT instructions; comments and RUN are not launchers),
 *  - package.json scripts,
 *  - the ENTRYPOINTS array of deploy/onprem/image-smoke/smoke.mjs.
 *
 * Anything that cannot be resolved with certainty is reported as unresolved (a problem), never skipped.
 */

export interface DockerLauncher {
  readonly instruction: 'CMD' | 'ENTRYPOINT';
  readonly line: number;
  readonly argv: readonly string[];
}

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const SHELL_OPERATOR = /(\&\&|\|\||[;|<>`]|\$\(|\$\{|\$[A-Za-z_])/;

/** Joins backslash continuations, drops comment lines, returns [line number, text] for each logical instruction. */
function logicalLines(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  const raw = text.replace(/\r\n/g, '\n').split('\n');
  let buffer = '';
  let start = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i]!;
    if (buffer === '' && (line.trim() === '' || line.trimStart().startsWith('#'))) continue;
    if (buffer === '') start = i + 1;
    if (buffer !== '' && line.trimStart().startsWith('#')) continue; // a comment inside a continued instruction
    if (/\\\s*$/.test(line)) {
      buffer += line.replace(/\\\s*$/, ' ');
      continue;
    }
    out.push([start, buffer + line]);
    buffer = '';
  }
  if (buffer !== '') out.push([start, buffer]);
  return out;
}

export function parseDockerfileLaunchers(text: string): ParseResult<DockerLauncher[]> {
  const launchers: DockerLauncher[] = [];
  for (const [lineNo, line] of logicalLines(text)) {
    const m = /^\s*(CMD|ENTRYPOINT)\s+(.*)$/i.exec(line);
    if (!m) continue;
    const instruction = m[1]!.toUpperCase() as 'CMD' | 'ENTRYPOINT';
    const rest = m[2]!.trim();
    if (rest.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rest);
      } catch {
        return { ok: false, message: `Dockerfile line ${lineNo}: ${instruction} exec form is not valid JSON` };
      }
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((p) => typeof p !== 'string')) {
        return { ok: false, message: `Dockerfile line ${lineNo}: ${instruction} exec form must be a non-empty array of strings` };
      }
      launchers.push({ instruction, line: lineNo, argv: parsed as string[] });
    } else {
      if (SHELL_OPERATOR.test(rest)) return { ok: false, message: `Dockerfile line ${lineNo}: ${instruction} shell form uses shell syntax that is not resolved here` };
      launchers.push({ instruction, line: lineNo, argv: rest.split(/\s+/) });
    }
  }
  return { ok: true, value: launchers };
}

export function parsePackageScripts(text: string): ParseResult<Record<string, string>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'package.json is not valid JSON' };
  }
  const scripts = (parsed as { scripts?: unknown } | null)?.scripts;
  if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return { ok: false, message: 'package.json has no scripts object' };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string') return { ok: false, message: `package.json script ${name} is not a string` };
    out[name] = value;
  }
  return { ok: true, value: out };
}

/** The string literals of `const ENTRYPOINTS = [ ... ];` in smoke.mjs. Fails when the array is absent, empty or not only literals. */
export function parseSmokeEntrypoints(text: string): ParseResult<string[]> {
  const m = /\bconst\s+ENTRYPOINTS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(text);
  if (!m) return { ok: false, message: 'smoke.mjs has no `const ENTRYPOINTS = [ ... ];` array' };
  const body = m[1]!.replace(/\/\/[^\n]*/g, '');
  const literals = [...body.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)].map((x) => x[1] ?? x[2] ?? '');
  const leftover = body.replace(/'([^'\\\n]*)'|"([^"\\\n]*)"/g, '').replace(/[\s,]/g, '');
  if (leftover !== '') return { ok: false, message: 'smoke.mjs ENTRYPOINTS contains something other than string literals' };
  if (literals.length === 0) return { ok: false, message: 'smoke.mjs ENTRYPOINTS is empty' };
  return { ok: true, value: literals };
}

const OPTIONS_WITH_VALUE = new Set(['--import', '--require', '-r', '--loader', '--experimental-loader', '--env-file']);
const PROGRAMS = new Set(['node', 'npx', 'tsx']);
const FILE_EXTENSION = /\.(?:ts|mts|cts|js|mjs|cjs)$/;

/** A command (tokens) of the form node|npx|tsx [options] <one script file> [arguments]; resolves to that file. */
function resolveCommand(tokens: readonly string[]): ParseResult<string> {
  if (tokens.length === 0) return { ok: false, message: 'empty command' };
  const program = tokens[0]!.replace(/^.*[\\/]/, '').replace(/\.cmd$|\.exe$/, '');
  if (!PROGRAMS.has(program)) return { ok: false, message: `program "${tokens[0]}" is not node, npx or tsx` };
  const candidates: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (OPTIONS_WITH_VALUE.has(t)) {
      i += 1;
      continue;
    }
    if (t.startsWith('-')) continue;
    if (FILE_EXTENSION.test(t)) candidates.push(t.replace(/^\.\//, ''));
  }
  if (candidates.length !== 1) return { ok: false, message: `expected exactly one script file in "${tokens.join(' ')}", found ${candidates.length}` };
  return { ok: true, value: candidates[0]! };
}

/**
 * Resolves an argv to the repository file it ultimately runs. `npm start` and `npm run <name>` go through the
 * package.json script (recursively, depth 5). A script with shell operators, environment assignments or an
 * unknown program is unresolved.
 */
export function resolveArgvToEntryFile(argv: readonly string[], scripts: Readonly<Record<string, string>>, depth = 0): ParseResult<string> {
  if (depth > 5) return { ok: false, message: 'npm script chain is deeper than 5' };
  if (argv.length === 0) return { ok: false, message: 'empty argv' };
  const program = argv[0]!.replace(/^.*[\\/]/, '').replace(/\.cmd$/, '');
  if (program === 'npm') {
    const rest = argv.slice(1).filter((a) => a !== '--silent' && a !== '-s');
    let name: string | undefined;
    if (rest[0] === 'start') name = 'start';
    else if ((rest[0] === 'run' || rest[0] === 'run-script') && rest[1] !== undefined) name = rest[1];
    if (name === undefined) return { ok: false, message: `npm command "${argv.join(' ')}" is not "npm start" or "npm run <script>"` };
    const body = scripts[name];
    if (body === undefined) return { ok: false, message: `package.json has no script "${name}"` };
    if (SHELL_OPERATOR.test(body) || /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(body)) return { ok: false, message: `script "${name}" uses shell syntax or an environment assignment` };
    return resolveArgvToEntryFile(body.trim().split(/\s+/), scripts, depth + 1);
  }
  return resolveCommand(argv);
}
