import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import type { HashDescriptor, SignatureDescriptor } from "../../mps-core/src/types";
import type { DatasetApprovalSigner } from "./DatasetApprovalAuthority";
import { DATASET_APPROVAL_AUTHORITY_DOMAIN } from "./DatasetApprovalAuthorityDomain";

export interface DatasetApprovalPemKeyMaterial {
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}

/**
 * DatasetApprovalSigner over an externally provisioned Ed25519 PEM pair.
 * Does not generate keys. Private material must come from trusted runtime config.
 */
export function createDatasetApprovalEd25519Signer(
  material: DatasetApprovalPemKeyMaterial,
): DatasetApprovalSigner {
  if (!material.keyId?.trim()) {
    throw new Error("REJECT_DATASET_APPROVAL_SIGNER_KEY_ID_REQUIRED");
  }
  if (!material.privateKeyPem?.trim() || !material.publicKeyPem?.trim()) {
    throw new Error("REJECT_DATASET_APPROVAL_SIGNER_PEM_REQUIRED");
  }
  // Fail closed at construction if PEM is malformed.
  createPrivateKey(material.privateKeyPem);
  createPublicKey(material.publicKeyPem);

  return {
    keyId: material.keyId,
    async sign(hash: HashDescriptor): Promise<SignatureDescriptor> {
      const key = createPrivateKey(material.privateKeyPem);
      const digestBytes = Buffer.from(hash.digest, "hex");
      const sig = cryptoSign(null, digestBytes, key);
      return {
        algorithm: "ed25519",
        key_id: material.keyId,
        signature: `ed25519:${sig.toString("base64")}`,
      };
    },
  };
}

export function datasetApprovalSignerAuthorityDomain(): typeof DATASET_APPROVAL_AUTHORITY_DOMAIN {
  return DATASET_APPROVAL_AUTHORITY_DOMAIN;
}
