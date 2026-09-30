/**
 * PATTERN-PROOF-ENGINE-01 V1 -- package.json lifecycle-script inspection (grounding report section 6).
 *
 * `L` in the classification predicate: the file paths a candidate's npm lifecycle scripts execute
 * with `node <path>`. Derived from the candidate's own package.json so that removing the hook (or
 * pointing it elsewhere) is reflected in the derived state.
 *
 * Derivation rules (R1 F1): a script string is split into commands on `&&`, `||`, `|` and `;`;
 * `npm run <name>` is resolved ONE level into `scripts[name]`; every derived path is normalized with
 * path.posix.normalize (so `./scripts/x.mjs`, `scripts//x.mjs` and `scripts/x.mjs` are the same
 * member of `L`). Absolute paths are kept absolute here and relativised to the probe's workdir by the
 * classifier. A lifecycle script that derives NO node path (npx/tsx/sh runners) is reported by the
 * classifier as BLOCKED LIFECYCLE_RUNNER_UNSUPPORTED when the install fails, never silently PASS.
 */
import path from 'node:path';
import { splitShellCommands } from '../internal/linear-text';
import { isPlainObject } from '../internal/plain-object';
import { PatternProofError } from '../errors';

export const LIFECYCLE_SCRIPT_NAMES = ['preinstall', 'install', 'postinstall', 'prepare'] as const;

export type LifecycleScriptName = (typeof LIFECYCLE_SCRIPT_NAMES)[number];

export interface PackageIdentity {
  readonly name: string;
  readonly version: string;
}

/** node flags that consume the following token (so it is not mistaken for the script path) */
const NODE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-r',
  '--require',
  '--import',
  '--loader',
  '--experimental-loader',
  '--env-file',
  '--conditions',
  '-C',
]);

function scriptsOf(packageJson: unknown): Record<string, unknown> {
  if (!isPlainObject(packageJson)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'package.json must be a plain object', {
      path: 'package.json',
    });
  }
  const scripts = packageJson.scripts;
  return isPlainObject(scripts) ? scripts : {};
}

/** The raw lifecycle script strings (preinstall, install, postinstall, prepare), in that order. */
export function lifecycleScriptStrings(packageJson: unknown): string[] {
  const scripts = scriptsOf(packageJson);
  const out: string[] = [];
  for (const name of LIFECYCLE_SCRIPT_NAMES) {
    const value = scripts[name];
    if (typeof value === 'string' && value.trim().length > 0) out.push(value);
  }
  return out;
}

/**
 * Shell command separators recognised in a script string or a RUN shell text: `&&`, `||`, `|`, `;`.
 * `splitShellCommands` is shared with the stage-prefix install predicate (R2 F8) so both split
 * identically; it is linear where the former `\s*(...)\s*` expression was quadratic.
 */
export { splitShellCommands };

/** Drops one pair of surrounding single or double quotes from a token (`'scripts/x.mjs'`, R2 F2). */
const SURROUNDING_QUOTES_RE = /^(['"])(.*)\1$/;

/** posix-normalizes a script path and drops a leading `./` (path.posix.normalize keeps `../`). */
export function normalizeScriptPath(scriptPath: string): string {
  const normalized = path.posix.normalize(scriptPath.replace(/\\/g, '/'));
  return normalized.startsWith('./') ? normalized.slice(2) : normalized;
}

/**
 * Splits one script string into its commands (on `&&`, `||`, `|`, `;`), each as a token list.
 * Surrounding single/double quotes are stripped from every token (R2 F2: `node 'scripts/x.mjs'`
 * names the same file as `node scripts/x.mjs`).
 */
export function scriptCommandsOf(script: string): string[][] {
  return splitShellCommands(script)
    .map((command) =>
      command
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)
        .map((token) => token.replace(SURROUNDING_QUOTES_RE, '$2'))
        .filter((token) => token.length > 0),
    )
    .filter((tokens) => tokens.length > 0);
}

/** Skips leading `KEY=value` environment assignments of a command. */
function commandWord(tokens: readonly string[]): number {
  let k = 0;
  while (k < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[k])) k += 1;
  return k;
}

/**
 * Path tokens following `node ` in one script string (commands split on `&&`, `||`, `|`, `;`),
 * normalized. When `scripts` is given, `npm run <name>` / `npm run-script <name>` is resolved ONE
 * level into `scripts[name]` (a nested `npm run` inside that script is not followed).
 */
export function nodeScriptPathsOf(script: string, scripts: Readonly<Record<string, unknown>> = {}): string[] {
  const out: string[] = [];
  const visit = (text: string, depth: number): void => {
    for (const tokens of scriptCommandsOf(text)) {
      const start = commandWord(tokens);
      const word = tokens[start];
      if (word === 'npm' && depth === 0) {
        const sub = tokens[start + 1];
        const name = tokens[start + 2];
        if ((sub === 'run' || sub === 'run-script') && name !== undefined) {
          const target = scripts[name];
          if (typeof target === 'string') visit(target, depth + 1);
        }
        continue;
      }
      if (word !== 'node') continue;
      let k = start + 1;
      while (k < tokens.length && tokens[k].startsWith('-')) {
        k += NODE_VALUE_FLAGS.has(tokens[k]) ? 2 : 1;
      }
      if (k < tokens.length) out.push(normalizeScriptPath(tokens[k]));
    }
  };
  visit(script, 0);
  return out;
}

/**
 * `L`: every `node <path>` target of the candidate's lifecycle scripts (one level of `npm run`
 * resolved against the same package.json), ordered, de-duplicated, normalized.
 */
export function lifecycleScriptPaths(packageJson: unknown): string[] {
  const scripts = scriptsOf(packageJson);
  const out: string[] = [];
  for (const script of lifecycleScriptStrings(packageJson)) {
    for (const scriptPath of nodeScriptPathsOf(script, scripts)) {
      if (!out.includes(scriptPath)) out.push(scriptPath);
    }
  }
  return out;
}

/** `{ name, version }` for the lifecycle banner `> <name>@<version> postinstall`. */
export function packageIdentity(packageJson: unknown): PackageIdentity {
  if (!isPlainObject(packageJson)) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'package.json must be a plain object', {
      path: 'package.json',
    });
  }
  const { name, version } = packageJson;
  if (typeof name !== 'string' || name.length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'package.json name must be a non-empty string', {
      path: 'package.json.name',
    });
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new PatternProofError('PPE_SCHEMA_INVALID', 'package.json version must be a non-empty string', {
      path: 'package.json.version',
    });
  }
  return Object.freeze({ name, version });
}
