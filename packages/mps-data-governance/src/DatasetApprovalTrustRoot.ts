import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { HashDescriptor, SignatureDescriptor, SignatureVerifier } from "../../mps-core/src/types";
import {
  DATASET_APPROVAL_AUTHORITY_DOMAIN,
  type DatasetApprovalAuthorityDomain,
} from "./DatasetApprovalAuthorityDomain";
import type { DatasetApprovalTrustPort } from "./DatasetApprovalAuthority";

export interface DatasetApprovalTrustedPublicKey {
  readonly key_id: string;
  readonly public_key_pem: string;
  readonly authority_domain: DatasetApprovalAuthorityDomain;
}

export interface DatasetApprovalTrustRoot {
  readonly authority_domain: DatasetApprovalAuthorityDomain;
  resolve(keyId: string): DatasetApprovalTrustedPublicKey | null;
  listKeyIds(): readonly string[];
}

export class DatasetApprovalTrustRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetApprovalTrustRootError";
  }
}

/** In-memory trust root. Producer/caller cannot replace this after composition. */
export function createDatasetApprovalTrustRoot(
  keys: readonly DatasetApprovalTrustedPublicKey[],
): DatasetApprovalTrustRoot {
  const byId = new Map<string, DatasetApprovalTrustedPublicKey>();
  for (const key of keys) {
    if (key.authority_domain !== DATASET_APPROVAL_AUTHORITY_DOMAIN) {
      throw new DatasetApprovalTrustRootError(
        `REJECT_DATASET_APPROVAL_TRUST_DOMAIN: key_id '${key.key_id}' declares ` +
          `authority_domain '${key.authority_domain}', required '${DATASET_APPROVAL_AUTHORITY_DOMAIN}'`,
      );
    }
    if (!key.key_id?.trim() || !key.public_key_pem?.trim()) {
      throw new DatasetApprovalTrustRootError("REJECT_DATASET_APPROVAL_TRUST_ENTRY_INCOMPLETE");
    }
    if (byId.has(key.key_id)) {
      throw new DatasetApprovalTrustRootError(
        `REJECT_DATASET_APPROVAL_TRUST_DUPLICATE_KEY_ID: '${key.key_id}'`,
      );
    }
    byId.set(key.key_id, key);
  }
  return {
    authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN,
    resolve(keyId: string) {
      return byId.get(keyId) ?? null;
    },
    listKeyIds() {
      return [...byId.keys()];
    },
  };
}

export function createDatasetApprovalTrustPort(trustRoot: DatasetApprovalTrustRoot): DatasetApprovalTrustPort {
  return {
    async assertTrustedDatasetApprovalSigner(keyId: string): Promise<void> {
      const resolved = trustRoot.resolve(keyId);
      if (!resolved) {
        throw new Error("REJECT_UNTRUSTED_DATASET_APPROVAL_SIGNER");
      }
      if (resolved.authority_domain !== DATASET_APPROVAL_AUTHORITY_DOMAIN) {
        throw new Error("REJECT_DATASET_APPROVAL_WRONG_AUTHORITY_DOMAIN");
      }
    },
  };
}

/**
 * Verifier-controlled SignatureVerifier. Unknown key_id, untrusted key, and
 * cryptographically invalid signatures all return false / fail closed.
 */
export function createDatasetApprovalSignatureVerifier(
  trustRoot: DatasetApprovalTrustRoot,
): SignatureVerifier {
  return {
    async verify(hash: HashDescriptor, signature: SignatureDescriptor): Promise<boolean> {
      const keyId = signature.key_id?.trim();
      if (!keyId) return false;
      const trusted = trustRoot.resolve(keyId);
      if (!trusted) return false;
      if (trusted.authority_domain !== DATASET_APPROVAL_AUTHORITY_DOMAIN) return false;
      const algorithm = signature.algorithm?.toLowerCase();
      if (algorithm !== "ed25519") return false;
      const raw = signature.signature?.startsWith("ed25519:")
        ? signature.signature.slice("ed25519:".length)
        : signature.signature;
      if (!raw) return false;
      try {
        const key = createPublicKey(trusted.public_key_pem);
        const digestBytes = Buffer.from(hash.digest, "hex");
        const sigBytes = Buffer.from(raw, "base64");
        return cryptoVerify(null, digestBytes, key, sigBytes);
      } catch {
        return false;
      }
    },
  };
}

interface TrustedKeysFileShape {
  readonly authority_domain?: string;
  readonly keys?: Readonly<Record<string, string>>;
}

/**
 * Loads the DatasetApproval trust root from verifier-controlled configuration.
 * Callers cannot supply a replacement trust policy through an approval request.
 *
 * Preferred: DATASET_APPROVAL_TRUSTED_KEYS_FILE → JSON
 *   { "authority_domain": "DATASET_APPROVAL", "keys": { "<key_id>": "<public PEM>" } }
 * Fallback: DATASET_APPROVAL_SIGNING_KEY_ID + DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM
 *
 * Foreign env blocks (GOVERNANCE_SIGNING_*, SOURCE_REGISTRY_*) are never consulted.
 */
export function loadDatasetApprovalTrustRootFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatasetApprovalTrustRoot {
  refuseForeignTrustEnv(env);

  const file = env.DATASET_APPROVAL_TRUSTED_KEYS_FILE?.trim();
  if (file) {
    const path = resolve(file);
    if (!existsSync(path)) {
      throw new DatasetApprovalTrustRootError(
        `BLOCKED_BY_DATASET_APPROVAL_TRUST_ANCHOR: DATASET_APPROVAL_TRUSTED_KEYS_FILE '${path}' does not exist`,
      );
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as TrustedKeysFileShape;
    if (parsed.authority_domain !== DATASET_APPROVAL_AUTHORITY_DOMAIN) {
      throw new DatasetApprovalTrustRootError(
        `BLOCKED_BY_DATASET_APPROVAL_TRUST_ANCHOR: trusted keys file must declare ` +
          `authority_domain '${DATASET_APPROVAL_AUTHORITY_DOMAIN}'`,
      );
    }
    if (!parsed.keys || typeof parsed.keys !== "object" || Array.isArray(parsed.keys)) {
      throw new DatasetApprovalTrustRootError(
        "BLOCKED_BY_DATASET_APPROVAL_TRUST_ANCHOR: trusted keys file must contain keys object",
      );
    }
    const entries = Object.entries(parsed.keys).map(([key_id, public_key_pem]) => ({
      key_id,
      public_key_pem,
      authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN,
    }));
    if (entries.length === 0) {
      throw new DatasetApprovalTrustRootError(
        "BLOCKED_BY_DATASET_APPROVAL_TRUST_ANCHOR: trusted keys file contains no keys",
      );
    }
    return createDatasetApprovalTrustRoot(entries);
  }

  const keyId = env.DATASET_APPROVAL_SIGNING_KEY_ID?.trim();
  const publicPem = env.DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM?.trim();
  if (keyId && publicPem) {
    return createDatasetApprovalTrustRoot([
      { key_id: keyId, public_key_pem: publicPem, authority_domain: DATASET_APPROVAL_AUTHORITY_DOMAIN },
    ]);
  }

  throw new DatasetApprovalTrustRootError(
    "BLOCKED_BY_DATASET_APPROVAL_TRUST_ANCHOR: configure DATASET_APPROVAL_TRUSTED_KEYS_FILE " +
      "or DATASET_APPROVAL_SIGNING_KEY_ID + DATASET_APPROVAL_SIGNING_PUBLIC_KEY_PEM. " +
      "GOVERNANCE_SIGNING_* / SOURCE_REGISTRY_* are not DatasetApproval trust anchors.",
  );
}

function refuseForeignTrustEnv(env: NodeJS.ProcessEnv): void {
  // Presence of foreign keys is fine for other subsystems; DatasetApproval must not read them.
  void env.GOVERNANCE_SIGNING_PUBLIC_KEY_PEM;
  void env.SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM;
  void env.SOURCE_REGISTRY_TRUSTED_KEYS_FILE;
}
