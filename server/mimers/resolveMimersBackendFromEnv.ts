import path from 'node:path';
import type { DurabilityMode, SigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  CasRootRequiredError,
  LedgerRootContractError,
  resolveDurableCasRoot,
  resolveMimersBackendRootFromCasRoot,
} from '../../packages/mps-runtime/src/mimers/DurableCasRoot.js';
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
 * Resolve Mimers persistent backend from env.
 *
 * Production authority:
 * - `CAS_ROOT` = exact physical CAS directory (basename must be `cas`)
 * - ledger = sibling `<parent>/ledger` derived only from that CAS_ROOT
 * - `MIMERS_ROOT` is NOT used for CAS location (runtime/config/secrets only)
 *
 * Test/smoke may still pass `fallbackCasRoot` explicitly.
 */
export async function resolveMimersBackendFromEnv(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    /** Explicit CAS directory for smoke/tests (exact CAS path, basename `cas`). */
    readonly fallbackCasRoot?: string;
    /** @deprecated Use fallbackCasRoot. Ignored when CAS_ROOT / fallbackCasRoot present. */
    readonly fallbackRoot?: string;
    readonly signing?: SigningKeyProvider;
  } = {},
): Promise<PersistentMimersBackend | null> {
  const env = options.env ?? process.env;
  const casRaw = env.CAS_ROOT?.trim() || options.fallbackCasRoot?.trim() || null;

  if (!casRaw) {
    // Legacy smoke: fallbackRoot was a Mimers backend parent containing /cas.
    // Only honour when explicitly provided AND CAS_ROOT is unset — still fail closed
    // under MIMERS_REQUIRED without inventing MIMERS_ROOT→CAS authority.
    if (options.fallbackRoot?.trim()) {
      const rootDir = path.resolve(options.fallbackRoot.trim());
      const durabilityMode = parseMimersDurabilityMode(env.MIMERS_DURABILITY_MODE);
      return createPersistentMimersBackend(rootDir, {
        durabilityMode,
        signing: options.signing,
      });
    }
    if (isMimersRequired(env)) {
      throw new CasRootRequiredError(
        'persistent Mimers backend',
        'MIMERS_REQUIRED is set but CAS_ROOT is missing (and no fallbackCasRoot was provided)',
      );
    }
    return null;
  }

  const casRoot = env.CAS_ROOT?.trim()
    ? resolveDurableCasRoot(env, 'persistent Mimers backend')
    : path.resolve(casRaw);

  let rootDir: string;
  try {
    rootDir = resolveMimersBackendRootFromCasRoot(casRoot);
  } catch (error) {
    if (error instanceof LedgerRootContractError) throw error;
    throw error;
  }

  const durabilityMode = parseMimersDurabilityMode(env.MIMERS_DURABILITY_MODE);
  return createPersistentMimersBackend(rootDir, {
    durabilityMode,
    signing: options.signing,
    expectedCasRoot: casRoot,
  });
}

/** Fail-closed resolver for CAS-primary mode. */
export async function requireMimersBackendFromEnv(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly fallbackCasRoot?: string;
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
