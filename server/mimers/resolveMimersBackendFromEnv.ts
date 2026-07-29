import path from 'node:path';
import type { DurabilityMode, SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createPersistentMimersBackend,
  type PersistentMimersBackend,
} from './createPersistentMimersBackend';

const DURABILITY_MODES = new Set<DurabilityMode>(['strict', 'best-effort', 'none']);

/** Parse MIMERS_DURABILITY_MODE; default best-effort (Windows-safe). */
export function parseMimersDurabilityMode(raw: string | undefined): DurabilityMode {
  if (!raw) return 'best-effort';
  const normalized = raw.trim().toLowerCase() as DurabilityMode;
  if (!DURABILITY_MODES.has(normalized)) {
    throw new Error(
      `Invalid MIMERS_DURABILITY_MODE='${raw}'. Expected one of: strict, best-effort, none`,
    );
  }
  return normalized;
}

/** True when MIMERS_REQUIRED is 1/true/yes (CAS-primary / fail-closed). */
export function isMimersRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.MIMERS_REQUIRED?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Resolve Mimers backend from env (ADR-042 dual-write opt-in).
 *
 * - `MIMERS_ROOT` set → create persistent backend under that root.
 * - else `fallbackRoot` → use that (smoke/tests).
 * - else → `null` (evolve stays FileArtifactStore-only V3),
 *   unless `MIMERS_REQUIRED` → throw.
 */
export async function resolveMimersBackendFromEnv(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly fallbackRoot?: string;
    readonly signing?: SigningKeyProvider;
  } = {},
): Promise<PersistentMimersBackend | null> {
  const env = options.env ?? process.env;
  const rootRaw = env.MIMERS_ROOT?.trim() || options.fallbackRoot;
  if (!rootRaw) {
    if (isMimersRequired(env)) {
      throw new Error(
        'MIMERS_REQUIRED is set but MIMERS_ROOT is missing (and no fallbackRoot was provided)',
      );
    }
    return null;
  }

  const rootDir = path.resolve(rootRaw);
  const durabilityMode = parseMimersDurabilityMode(env.MIMERS_DURABILITY_MODE);
  return createPersistentMimersBackend(rootDir, {
    durabilityMode,
    signing: options.signing,
  });
}

/** Fail-closed resolver for CAS-primary mode. */
export async function requireMimersBackendFromEnv(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly fallbackRoot?: string;
    readonly signing?: SigningKeyProvider;
  } = {},
): Promise<PersistentMimersBackend> {
  const env = options.env ?? process.env;
  const resolved = await resolveMimersBackendFromEnv({
    ...options,
    env: { ...env, MIMERS_REQUIRED: env.MIMERS_REQUIRED ?? 'true' },
  });
  if (!resolved) {
    throw new Error('requireMimersBackendFromEnv: backend resolution returned null');
  }
  return resolved;
}
