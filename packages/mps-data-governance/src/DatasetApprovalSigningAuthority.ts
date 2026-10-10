import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatasetApprovalSigner } from "./DatasetApprovalAuthority";
import { DATASET_APPROVAL_AUTHORITY_DOMAIN } from "./DatasetApprovalAuthorityDomain";
import {
  createDatasetApprovalEd25519Signer,
  type DatasetApprovalPemKeyMaterial,
} from "./DatasetApprovalEd25519Signer";
import type { DatasetApprovalTrustRoot } from "./DatasetApprovalTrustRoot";

export class DatasetApprovalSigningAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetApprovalSigningAuthorityError";
  }
}

/**
 * Loads the DatasetApproval signing private key from trusted runtime configuration only.
 *
 * Accepted sources (in order):
 * 1. DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM + PUBLIC + KEY_ID env vars
 * 2. DATASET_APPROVAL_SIGNING_SECRETS_DIR → {private,public}.pem + KEY_ID env
 *
 * Never reads GOVERNANCE_SIGNING_*, SOURCE_REGISTRY_* private keys, CLI payloads,
 * or approval request bodies. Never generates key material.
 */
export function loadDatasetApprovalSignerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  trustRoot?: DatasetApprovalTrustRoot,
): DatasetApprovalSigner {
  refuseForeignSigningEnv(env);
  const material = resolvePemMaterial(env);
  const signer = createDatasetApprovalEd25519Signer(material);
  if (trustRoot) {
    const trusted = trustRoot.resolve(signer.keyId);
    if (!trusted) {
      throw new DatasetApprovalSigningAuthorityError(
        `BLOCKED_BY_DATASET_APPROVAL_KEY_PROVISIONING: signer key_id '${signer.keyId}' ` +
          `is not present in the DatasetApproval trust root`,
      );
    }
    if (trusted.authority_domain !== DATASET_APPROVAL_AUTHORITY_DOMAIN) {
      throw new DatasetApprovalSigningAuthorityError(
        "REJECT_DATASET_APPROVAL_WRONG_AUTHORITY_DOMAIN",
      );
    }
  }
  return signer;
}

function resolvePemMaterial(env: NodeJS.ProcessEnv): DatasetApprovalPemKeyMaterial {
  const keyId = env.DATASET_APPROVAL_SIGNING_KEY_ID?.trim();
  const privatePem = env.DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM?.trim();
  const publicPem = env.DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM?.trim();
  if (keyId && privatePem && publicPem) {
    return { keyId, privateKeyPem: privatePem, publicKeyPem: publicPem };
  }

  const secretsDir = env.DATASET_APPROVAL_SIGNING_SECRETS_DIR?.trim();
  if (secretsDir) {
    if (!keyId) {
      throw new DatasetApprovalSigningAuthorityError(
        "BLOCKED_BY_DATASET_APPROVAL_KEY_PROVISIONING: DATASET_APPROVAL_SIGNING_KEY_ID is required " +
          "when DATASET_APPROVAL_SIGNING_SECRETS_DIR is set",
      );
    }
    const dir = resolve(secretsDir);
    const privatePath = resolve(dir, "private.pem");
    const publicPath = resolve(dir, "public.pem");
    if (!existsSync(privatePath) || !existsSync(publicPath)) {
      throw new DatasetApprovalSigningAuthorityError(
        `BLOCKED_BY_DATASET_APPROVAL_KEY_PROVISIONING: expected private.pem and public.pem under '${dir}'`,
      );
    }
    return {
      keyId,
      privateKeyPem: readFileSync(privatePath, "utf8"),
      publicKeyPem: readFileSync(publicPath, "utf8"),
    };
  }

  throw new DatasetApprovalSigningAuthorityError(
    "BLOCKED_BY_DATASET_APPROVAL_KEY_PROVISIONING: configure " +
      "DATASET_APPROVAL_SIGNING_KEY_ID + DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM + " +
      "DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM, or DATASET_APPROVAL_SIGNING_SECRETS_DIR " +
      "pointing at an externally provisioned DatasetApproval key pair outside the repository. " +
      "Do not reuse GOVERNANCE_SIGNING_* / SOURCE_REGISTRY_* / DEV-GOV keys.",
  );
}

function refuseForeignSigningEnv(env: NodeJS.ProcessEnv): void {
  // Explicit non-use: foreign private-key env vars are never a DatasetApproval source.
  if (
    !env.DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM?.trim() &&
    !env.DATASET_APPROVAL_SIGNING_SECRETS_DIR?.trim() &&
    (env.GOVERNANCE_SIGNING_PRIVATE_KEY_PEM?.trim() ||
      env.SOURCE_REGISTRY_SIGNING_PRIVATE_KEY_PEM?.trim())
  ) {
    throw new DatasetApprovalSigningAuthorityError(
      "BLOCKED_BY_DATASET_APPROVAL_KEY_PROVISIONING: a foreign signing private key is present " +
        "(GOVERNANCE_SIGNING_* or SOURCE_REGISTRY_*) but no DatasetApproval signing configuration. " +
        "Cryptographic capability ≠ DatasetApproval authority — provision a dedicated key.",
    );
  }
}

export function requiredDatasetApprovalSigningConfiguration(): readonly string[] {
  return [
    "DATASET_APPROVAL_SIGNING_KEY_ID",
    "DATASET_APPROVAL_SIGNING_PRIVATE_KEY_PEM",
    "DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM",
    "— or —",
    "DATASET_APPROVAL_SIGNING_KEY_ID",
    "DATASET_APPROVAL_SIGNING_SECRETS_DIR=<absolute path outside repo with private.pem + public.pem>",
    "DATASET_APPROVAL_TRUSTED_KEYS_FILE or PUBLIC_KEY_PEM matching the same key_id under authority_domain DATASET_APPROVAL",
  ];
}
