import type { SignatureVerifier } from "../../packages/mps-core/src/types";
import {
  createDatasetApprovalSignatureVerifier,
  loadDatasetApprovalTrustRootFromEnv,
} from "../../packages/mps-data-governance/src/DatasetApprovalTrustRoot";

/**
 * Public-only DatasetApproval verification composition.
 * Never imports the private-key loader — that asymmetry is the trust boundary.
 */
let cachedVerifier: SignatureVerifier | null = null;

export function getDatasetApprovalSignatureVerifier(
  env: NodeJS.ProcessEnv = process.env,
): SignatureVerifier {
  if (cachedVerifier) return cachedVerifier;
  const trustRoot = loadDatasetApprovalTrustRootFromEnv(env);
  cachedVerifier = createDatasetApprovalSignatureVerifier(trustRoot);
  return cachedVerifier;
}

/** Test-only escape hatch. */
export function __resetDatasetApprovalVerifierForTests(): void {
  cachedVerifier = null;
}
