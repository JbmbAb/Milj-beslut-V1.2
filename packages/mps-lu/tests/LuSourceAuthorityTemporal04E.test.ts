import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  assertLuExecutionAuthorityLifecycleCurrent,
  attestLuExecutionAuthorityLifecycle,
  createLuExecutionAuthorityLifecycleArtifact,
  verifyLuExecutionAuthorityLifecycle,
} from "../src/governance/LuExecutionAuthorityLifecycle.js";
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
  readonly attempt_id?: string;
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
  const bareLifecycle = createLuExecutionAuthorityLifecycleArtifact({
    root,
    issuer,
    valid_from: input.valid_from ?? "2026-01-01T00:00:00.000Z",
    valid_until: input.valid_until ?? "2027-01-01T00:00:00.000Z",
    revoked_at: input.revoked_at ?? null,
  });
  const lifecycle = {
    ...bareLifecycle,
    attestation: await attestLuExecutionAuthorityLifecycle({
      lifecycle: bareLifecycle,
      root,
      signing: rootKey.provider,
    }),
  };
  const subjectBody = {
    artifact_id: "execution-identity-04e",
    artifact_type: "execution_identity",
    references: [ref(issuer)],
  } as const;
  const subject: ArtifactContract = {
    ...subjectBody,
    content_hash: sha256ContentHash(subjectBody),
  };
  const attemptRef = {
    artifact_id: input.attempt_id ?? "attempt-lu-04e-1",
    artifact_type: "execution_attempt",
  } as const;
  const bareStatus = createLuSourceAuthorityTemporalStatusArtifact({
    issuer_ref: ref(issuer),
    subject,
    attempt_ref: attemptRef,
    lifecycle,
    action: "lu.localization_assessment.persist",
    decision_time: input.decision_time ?? "2026-09-17T12:00:00.000Z",
  });
  const status = {
    ...bareStatus,
    attestation: await attestLuSourceAuthorityTemporalStatus({
      status: bareStatus,
      signing: issuerKey.provider,
    }),
  };
  const rootVerification = new LocalPemVerificationKeyProvider(
    rootKey.provider.keyId,
    rootKey.publicKey,
  );
  const issuerVerification = new LocalPemVerificationKeyProvider(
    issuerKey.provider.keyId,
    issuerKey.publicKey,
  );
  return {
    root,
    issuer,
    lifecycle,
    subject,
    attemptRef,
    status,
    rootVerification,
    issuerVerification,
  };
}

async function verifyHistorical(f: Awaited<ReturnType<typeof fixture>>) {
  await verifyLuExecutionAuthorityLifecycle({
    lifecycle: f.lifecycle,
    root: f.root,
    issuer: f.issuer,
    root_verification: f.rootVerification,
  });
  return verifyLuSourceAuthorityTemporalStatus({
    status: f.status,
    issuer: f.issuer,
    subject: f.subject,
    lifecycle: f.lifecycle,
    expected_attempt_ref: f.attemptRef,
    expected_action: "lu.localization_assessment.persist",
    issuer_verification: f.issuerVerification,
  });
}

describe("MINIMUM-AUTHORITY-DELTA-04E — lifecycle currentness + exact-attempt history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts when root-signed lifecycle is current and exact-attempt ticket is valid", async () => {
    const f = await fixture();
    await expect(
      verifyLuExecutionAuthorityLifecycle({
        lifecycle: f.lifecycle,
        root: f.root,
        issuer: f.issuer,
        root_verification: f.rootVerification,
      }),
    ).resolves.toEqual(f.lifecycle);
    expect(() => assertLuExecutionAuthorityLifecycleCurrent(f.lifecycle)).not.toThrow();
    await expect(verifyHistorical(f)).resolves.toEqual(f.status);
  });

  it("fails CURRENT admission before issuer qualification activation", async () => {
    const f = await fixture({ valid_from: "2026-10-01T00:00:00.000Z" });
    expect(() => assertLuExecutionAuthorityLifecycleCurrent(f.lifecycle)).toThrow(
      "qualification_not_active",
    );
  });

  it("fails CURRENT admission when issuer qualification has expired", async () => {
    const f = await fixture({ valid_until: "2026-09-17T12:00:00.000Z" });
    expect(() => assertLuExecutionAuthorityLifecycleCurrent(f.lifecycle)).toThrow(
      "qualification_expired",
    );
  });

  it("fails CURRENT admission when root-signed issuer revocation is effective", async () => {
    const f = await fixture({ revoked_at: "2026-09-17T11:59:59.000Z" });
    expect(() => assertLuExecutionAuthorityLifecycleCurrent(f.lifecycle)).toThrow(
      "authority_revoked",
    );
  });

  it("preserves historical authorized-at-decision-time evidence before a later revocation", async () => {
    const f = await fixture({
      revoked_at: "2026-09-18T00:00:00.000Z",
      decision_time: "2026-09-17T12:00:00.000Z",
    });
    await expect(verifyHistorical(f)).resolves.toEqual(f.status);
    vi.setSystemTime(new Date("2026-09-18T00:00:01.000Z"));
    expect(() => assertLuExecutionAuthorityLifecycleCurrent(f.lifecycle)).toThrow(
      "authority_revoked",
    );
  });

  it("cannot reuse an authorization ticket for another execution attempt", async () => {
    const f = await fixture();
    await expect(
      verifyLuSourceAuthorityTemporalStatus({
        status: f.status,
        issuer: f.issuer,
        subject: f.subject,
        lifecycle: f.lifecycle,
        expected_attempt_ref: {
          artifact_id: "attempt-lu-04e-2",
          artifact_type: "execution_attempt",
        },
        expected_action: "lu.localization_assessment.persist",
        issuer_verification: f.issuerVerification,
      }),
    ).rejects.toThrow("temporal_status_binding");
  });

  it("cannot reuse a ticket after lifecycle rotation", async () => {
    const f = await fixture();
    const nextBare = createLuExecutionAuthorityLifecycleArtifact({
      root: f.root,
      issuer: f.issuer,
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2028-01-01T00:00:00.000Z",
      previous_lifecycle_ref: ref(f.lifecycle),
    });
    const next = {
      ...nextBare,
      attestation: await attestLuExecutionAuthorityLifecycle({
        lifecycle: nextBare,
        root: f.root,
        signing: LocalPemSigningKeyProvider.generate("ed25519:wrong-root").provider,
      }).catch(() => undefined),
    };
    expect(next.artifact_id).not.toBe(f.lifecycle.artifact_id);
    await expect(
      verifyLuSourceAuthorityTemporalStatus({
        status: f.status,
        issuer: f.issuer,
        subject: f.subject,
        lifecycle: next,
        expected_attempt_ref: f.attemptRef,
        expected_action: "lu.localization_assessment.persist",
        issuer_verification: f.issuerVerification,
      }),
    ).rejects.toThrow("canonical mismatch");
  });

  it("rejects a mutated historical ticket body with the old attestation", async () => {
    const f = await fixture();
    const mutated = {
      ...f.status,
      payload: {
        ...f.status.payload,
        decision_time: "2026-09-17T12:00:01.000Z",
      },
    };
    await expect(
      verifyLuSourceAuthorityTemporalStatus({
        status: mutated,
        issuer: f.issuer,
        subject: f.subject,
        lifecycle: f.lifecycle,
        expected_attempt_ref: f.attemptRef,
        expected_action: "lu.localization_assessment.persist",
        issuer_verification: f.issuerVerification,
      }),
    ).rejects.toThrow("canonical mismatch");
  });
});
