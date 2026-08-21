import type { ArtifactContract } from "./ArtifactContract";
import { sha256ContentHash } from "../canonical/sha256Canonical";

export const ADMIN_ROLE_GRANT_ISSUER_ARTIFACT_TYPE = "admin_role_grant_issuer" as const;
export const ADMIN_ROLE_GRANT_ISSUER_VERSION = "admin-role-grant-issuer-v1" as const;
export const ADMIN_ROLE_GRANT_ISSUER_PURPOSE = "PRODUCT_ADMIN_ROLE_ISSUER_V1" as const;

export interface AdminRoleGrantIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof ADMIN_ROLE_GRANT_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly issuer_purpose: typeof ADMIN_ROLE_GRANT_ISSUER_PURPOSE;
    readonly allowed_artifact_types: readonly ["admin_role_grant"];
    readonly issuer_version: typeof ADMIN_ROLE_GRANT_ISSUER_VERSION;
  };
}

export function createAdminRoleGrantIssuerArtifact(input: {
  readonly issuer_key_id: string;
}): AdminRoleGrantIssuerArtifact {
  const issuerKeyId = input.issuer_key_id.trim();
  if (!issuerKeyId) throw new Error("REJECT_ADMIN_ROLE_GRANT_ISSUER: issuer_key_id is required");
  const payload: AdminRoleGrantIssuerArtifact["payload"] = {
    issuer_key_id: issuerKeyId,
    issuer_purpose: ADMIN_ROLE_GRANT_ISSUER_PURPOSE,
    allowed_artifact_types: ["admin_role_grant"],
    issuer_version: ADMIN_ROLE_GRANT_ISSUER_VERSION,
  };
  const identity = sha256ContentHash({
    canonicalizer_id: "rfc8785-sha256-v1",
    artifact_type: ADMIN_ROLE_GRANT_ISSUER_ARTIFACT_TYPE,
    payload,
  });
  const artifact: Omit<AdminRoleGrantIssuerArtifact, "content_hash"> = {
    artifact_id: `admin-role-grant-issuer-${identity.value.slice(0, 24)}`,
    artifact_type: ADMIN_ROLE_GRANT_ISSUER_ARTIFACT_TYPE,
    references: [],
    payload,
  };
  return {
    ...artifact,
    content_hash: sha256ContentHash(artifact),
  };
}
