/**
 * PATTERN-PROOF-ENGINE-01 V1 -- package.json lifecycle-script inspection (grounding report section 6).
 *
 * `L` in the classification predicate: the file paths a candidate's npm lifecycle scripts execute
 * with `node <path>`. Derived from the candidate's own package.json so that removing the hook (or
 * pointing it elsewhere) is reflected in the derived state.
 */
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/** Path tokens following `node ` in one script string, split on `&&` and `;`. */
export function nodeScriptPathsOf(script: string): string[] {
  const out: string[] = [];
  for (const command of script.split(/\s*(?:&&|;)\s*/)) {
    const tokens = command
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens[0] !== 'node') continue;
    let k = 1;
    while (k < tokens.length && tokens[k].startsWith('-')) {
      k += NODE_VALUE_FLAGS.has(tokens[k]) ? 2 : 1;
    }
    if (k < tokens.length) out.push(tokens[k]);
  }
  return out;
}

/** `L`: every `node <path>` target of the candidate's lifecycle scripts, ordered, de-duplicated. */
export function lifecycleScriptPaths(packageJson: unknown): string[] {
  const out: string[] = [];
  for (const script of lifecycleScriptStrings(packageJson)) {
    for (const scriptPath of nodeScriptPathsOf(script)) {
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
