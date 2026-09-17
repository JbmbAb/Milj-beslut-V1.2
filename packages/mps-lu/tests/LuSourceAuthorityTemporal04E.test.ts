import { describe, expect, it } from "vitest";
import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
} from "../../mimers-brunn-core/src/index.js";
import { sha256ContentHash } from "../../mps-compliance/src/canonical/sha256Canonical.js";
import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import {
  createLuExecutionAuthorityIssuerArtifact,
  createLuExecutionAuthorityRootArtifact,
} from "../src/artifacts/LuExecutionAuthorityArtifact.js";
import {
  attestLuSourceAuthorityTemporalStatus,
  createLuSourceAuthorityTemporalStatusArtifact,
  verifyLuSourceAuthorityTemporalStatus,
} from "../src/governance/LuSourceAuthorityTemporalStatus.js";

function ref(artifact: { readonly artifact_id: string; readonly artifact_type: string }) {
  return { artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type };
}

async function fixture(input: {
  readonly valid_from?: string;
  readonly valid_until?: string;
  readonly decision_time?: string;
  readonly revoked_at?: string | null;
} = {}) {
  const rootKey = LocalPemSigningKeyProvider.generate("ed25519:lu-root-04e");
  const issuerKey = LocalPemSigningKeyProvider.generate("ed25519:lu-issuer-04e");
  const root = createLuExecutionAuthorityRootArtifact({
    root_key_id: rootKey.provider.keyId,
    public_key_fingerprint: "root-fingerprint-04e",
  });
  const issuer = createLuExecutionAuthorityIssuerArtifact({
    issuer_key_id: issuerKey.provider.keyId,
    public_key_fingerprint: "issuer-fingerprint-04e",
    root_ref: ref(root),
  });
  const subjectBody = {
    artifact_id: "execution-identity-04e",
    artifact_type: "execution_identity",
    references: [ref(issuer)],
  } as const;
  const subject: ArtifactContract = {
    ...subjectBody,
    content_hash: sha256ContentHash(subjectBody),
  };
  const bareStatus = createLuSourceAuthorityTemporalStatusArtifact({
    root,
    issuer,
    subject,
    action: "lu.localization_assessment.persist",
    valid_from: input.valid_from ?? "2026-01-01T00:00:00.000Z",
    valid_until: input.valid_until ?? "2027-01-01T00:00:00.000Z",
    decision_time: input.decision_time ?? "2026-09-17T12:00:00.000Z",
    revoked_at: input.revoked_at ?? null,
  });
  const status = {
    ...bareStatus,
    attestation: await attestLuSourceAuthorityTemporalStatus({
      status: bareStatus,
      root,
      signing: rootKey.provider,
    }),
  };
  const rootVerification = new LocalPemVerificationKeyProvider(
    rootKey.provider.keyId,
    rootKey.publicKey,
  );
  return { root, issuer, subject, status, rootVerification };
}

async function verify(f: Awaited<ReturnType<typeof fixture>>) {
  return verifyLuSourceAuthorityTemporalStatus({
    status: f.status,
    root: f.root,
    issuer: f.issuer,
    subject: f.subject,
    expected_action: "lu.localization_assessment.persist",
    root_verification: f.rootVerification,
  });
}

describe("MINIMUM-AUTHORITY-DELTA-04E — temporal currentness and revocation", () => {
  it("accepts a root-signed qualification active at the canonical decision time", async () => {
    const f = await fixture();
    await expect(verify(f)).resolves.toEqual(f.status);
  });

  it("fails closed before qualification activation", async () => {
    const f = await fixture({
      valid_from: "2026-10-01T00:00:00.000Z",
      decision_time: "2026-09-17T12:00:00.000Z",
    });
    await expect(verify(f)).rejects.toThrow("qualification_not_active");
  });

  it("fails closed when the qualification is expired", async () => {
    const f = await fixture({
      valid_until: "2026-09-17T12:00:00.000Z",
      decision_time: "2026-09-17T12:00:00.000Z",
    });
    await expect(verify(f)).rejects.toThrow("qualification_expired");
  });

  it("fails closed when revocation is effective at T_decision", async () => {
    const f = await fixture({
      revoked_at: "2026-09-17T11:59:59.000Z",
      decision_time: "2026-09-17T12:00:00.000Z",
    });
    await expect(verify(f)).rejects.toThrow("authority_revoked");
  });

  it("does not retroactively invalidate a historical decision when revocation is later", async () => {
    const f = await fixture({
      revoked_at: "2026-09-18T00:00:00.000Z",
      decision_time: "2026-09-17T12:00:00.000Z",
    });
    await expect(verify(f)).resolves.toEqual(f.status);
  });

  it("rejects a mutated status body even when the old signed attestation is retained", async () => {
    const f = await fixture();
    const mutated = {
      ...f.status,
      payload: {
        ...f.status.payload,
        valid_until: "2030-01-01T00:00:00.000Z",
      },
    };
    await expect(
      verifyLuSourceAuthorityTemporalStatus({
        status: mutated,
        root: f.root,
        issuer: f.issuer,
        subject: f.subject,
        expected_action: "lu.localization_assessment.persist",
        root_verification: f.rootVerification,
      }),
    ).rejects.toThrow("canonical mismatch");
  });
});
