import type { DatasetApprovalSigner } from "../../packages/mps-data-governance/src/DatasetApprovalAuthority";
import { loadDatasetApprovalSignerFromEnv } from "../../packages/mps-data-governance/src/DatasetApprovalSigningAuthority";
import {
  loadDatasetApprovalTrustRootFromEnv,
  type DatasetApprovalTrustRoot,
} from "../../packages/mps-data-governance/src/DatasetApprovalTrustRoot";

/**
 * DatasetApproval signing authority (activation binding).
 *
 * Deliberately its OWN env/key domain — separate from `governanceSigningKey.ts`
 * (CAS promotion), SourceRegistry governor keys, document-fact review keys, and
 * DEV-GOV. Cryptographic capability of those keys does not authorize
 * DATASET_APPROVAL artifacts.
 *
 * Private key material must be provisioned outside the repository and loaded
 * only from trusted runtime configuration. This module never generates keys and
 * never accepts key material from an approval request payload.
 */
let cachedSigner: DatasetApprovalSigner | null = null;
let cachedTrust: DatasetApprovalTrustRoot | null = null;

export function getDatasetApprovalTrustRootFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatasetApprovalTrustRoot {
  if (cachedTrust) return cachedTrust;
  cachedTrust = loadDatasetApprovalTrustRootFromEnv(env);
  return cachedTrust;
}

export function getDatasetApprovalSigningProvider(
  env: NodeJS.ProcessEnv = process.env,
): DatasetApprovalSigner {
  if (cachedSigner) return cachedSigner;
  const trust = getDatasetApprovalTrustRootFromEnv(env);
  cachedSigner = loadDatasetApprovalSignerFromEnv(env, trust);
  return cachedSigner;
}

/** Test-only escape hatch. */
export function __resetDatasetApprovalSigningProviderForTests(): void {
  cachedSigner = null;
  cachedTrust = null;
}
