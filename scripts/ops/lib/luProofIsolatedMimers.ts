/**
 * LU-CANONICAL-RUNTIME-HARDENING-R1 -- isolated Mimers root for the LU bootstrap proof scripts.
 *
 * The LU proof scripts enable `MPS_LU_BOOTSTRAP_ADMIT=1` (bootstrap admission, no real governed
 * admission) and write real artifacts. That is only acceptable if they can never touch a
 * persistent CAS. So they never use the caller's configured `MIMERS_ROOT`: they do not read it,
 * inspect it, or write to it. Each run gets its own directory under the OS temp dir, handed to
 * `MimersIntegration.create` through an explicit cloned environment.
 *
 * The proof still runs against the REAL filesystem-backed Mimers CAS (`forceMimers: true`, checked
 * via `isMimersBacked`) -- never the in-memory test shortcut.
 */
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { MimersIntegration } from '@miljobeslut/mps-runtime';

const ROOT_PREFIX = 'lu-proof-mimers-';

export interface IsolatedMimersProof {
  /** The isolated temporary Mimers root. Distinct from any caller-configured MIMERS_ROOT. */
  readonly root: string;
  /** The explicit environment the Mimers integration was created with. */
  readonly env: NodeJS.ProcessEnv;
  readonly mimers: MimersIntegration;
  /** Machine-readable facts about the repository the proof actually used. */
  attest(): Promise<{ root: string; mimers_backed: boolean; cas_dir_present: boolean }>;
  /** Removes the temporary root. Refuses to delete anything it did not create itself. */
  cleanup(): Promise<void>;
}

export async function createIsolatedMimersProof(): Promise<IsolatedMimersProof> {
  const root = await mkdtemp(join(tmpdir(), ROOT_PREFIX));
  // A clone: process.env is neither read for MIMERS_ROOT nor mutated.
  const env: NodeJS.ProcessEnv = { ...process.env, MIMERS_ROOT: root };

  let mimers: MimersIntegration;
  try {
    mimers = await MimersIntegration.create({ env, forceMimers: true });
    if (!mimers.isMimersBacked) {
      throw new Error('LU proof requires the real filesystem-backed Mimers CAS, got a non-Mimers repository.');
    }
  } catch (error) {
    await removeOwnedRoot(root);
    throw error;
  }

  return {
    root,
    env,
    mimers,
    async attest() {
      const casDir = await stat(join(root, 'cas')).catch(() => null);
      return { root, mimers_backed: mimers.isMimersBacked, cas_dir_present: casDir?.isDirectory() ?? false };
    },
    cleanup: () => removeOwnedRoot(root),
  };
}

async function removeOwnedRoot(root: string): Promise<void> {
  const resolved = resolve(root);
  const ownedByUs =
    basename(resolved).startsWith(ROOT_PREFIX) && resolve(dirname(resolved)) === resolve(tmpdir());
  if (!ownedByUs) {
    throw new Error(`Refusing to delete '${resolved}': not an isolated LU proof root created by this helper.`);
  }
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
