import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/** The only local settings this governed runtime is allowed to import from an env file. */
export const LOKE_LANTMATERIET_ENVIRONMENT_NAMES = [
  "LANTMATERIET_STAC_BYGGNADER_BEARER_TOKEN",
  "LANTMATERIET_ACCESS_TOKEN",
  "LANTMATERIET_CONSUMER_KEY",
  "LANTMATERIET_CONSUMER_SECRET",
  "LANTMATERIET_TOKEN_URL",
] as const;

type LokeLantmaterietEnvironmentName = (typeof LOKE_LANTMATERIET_ENVIRONMENT_NAMES)[number];

export interface LokeRuntimeEnvironmentLoadResult {
  /** Paths are safe configuration provenance; parsed values are never returned or logged. */
  readonly loadedFiles: readonly string[];
  /** Existing public verification keyring, if this runtime needed the conventional local binding. */
  readonly trustedKeyringPath: string | null;
}

export interface LoadLokeRuntimeEnvironmentOptions {
  readonly cwd?: string;
  readonly primaryWorktreeRoot?: string | null;
  readonly environment?: NodeJS.ProcessEnv;
  readonly mimersHome?: string;
}

/**
 * Loads only the approved Lantmäteriet runtime contracts before Loke constructs its transports.
 *
 * Linked worktrees intentionally do not copy ignored `.env` files. For an operational worktree,
 * the primary worktree of this same Git repository is therefore the shared local configuration
 * boundary. Process values always win; no secret is copied, serialized, or reported.
 */
export function loadLokeRuntimeEnvironment(
  options: LoadLokeRuntimeEnvironmentOptions = {},
): LokeRuntimeEnvironmentLoadResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const environment = options.environment ?? process.env;
  const primaryRoot = options.primaryWorktreeRoot === undefined
    ? primaryWorktreeRoot(cwd)
    : options.primaryWorktreeRoot;
  const roots = uniqueRoots([cwd, primaryRoot]);
  const loadedFiles: string[] = [];

  for (const root of roots) {
    // Local overrides precede the base file; earlier values are never overwritten.
    for (const name of [".env.local", ".env"]) {
      const path = resolve(root, name);
      if (!existsSync(path)) continue;
      const values = parseEnv(readFileSync(path, "utf8"));
      let imported = false;
      for (const variableName of LOKE_LANTMATERIET_ENVIRONMENT_NAMES) {
        const value = values[variableName];
        if (!value?.trim() || environment[variableName]?.trim()) continue;
        environment[variableName] = value;
        imported = true;
      }
      if (imported) loadedFiles.push(path);
    }
  }

  const trustedKeyringPath = bindExistingSourceRegistryKeyring(
    environment,
    options.mimersHome ?? resolve(homedir(), ".mimers"),
  );
  return { loadedFiles, trustedKeyringPath };
}

/**
 * Loke receives verification capability only. This binds the already-managed public keyring;
 * it never reads a signing key, writes a keyring, or substitutes any other authority's key.
 */
function bindExistingSourceRegistryKeyring(environment: NodeJS.ProcessEnv, mimersHome: string): string | null {
  if (environment.SOURCE_REGISTRY_TRUSTED_KEYS_FILE?.trim()) return null;
  if (
    environment.SOURCE_REGISTRY_SIGNING_KEY_ID?.trim() &&
    environment.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM?.trim()
  ) {
    return null;
  }

  const keyringPath = resolve(mimersHome, "governance", "source-registry-trusted-keys.json");
  if (!existsSync(keyringPath)) return null;
  environment.SOURCE_REGISTRY_TRUSTED_KEYS_FILE = keyringPath;
  return keyringPath;
}

function primaryWorktreeRoot(cwd: string): string | null {
  try {
    const output = execFileSync("git", ["-C", cwd, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = output.split(/\r?\n/).find((line) => line.startsWith("worktree "));
    return first ? resolve(first.slice("worktree ".length)) : null;
  } catch {
    return null;
  }
}

function uniqueRoots(roots: ReadonlyArray<string | null>): string[] {
  const unique = new Set<string>();
  for (const root of roots) {
    if (root) unique.add(resolve(root));
  }
  return [...unique];
}

export function isSupportedLokeLantmaterietEnvironmentName(
  name: string,
): name is LokeLantmaterietEnvironmentName {
  return (LOKE_LANTMATERIET_ENVIRONMENT_NAMES as readonly string[]).includes(name);
}
