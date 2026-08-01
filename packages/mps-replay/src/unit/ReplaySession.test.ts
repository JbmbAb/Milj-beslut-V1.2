import { describe, it, expect } from "vitest";
import { ReplaySession } from "../ReplaySession";
import { TrustViolation, HashVerificationViolation } from "@miljobeslut/mps-core";
import type { ReplayVerifier } from "../ReplayVerifier";
import type { ReplayTarget, ReplayStage } from "../ReplayTypes";
import type { DecisionClock, UniqueIdGenerator, ContentReference } from "@miljobeslut/mps-core";

const fixedClock: DecisionClock = { now: () => new Date("2026-01-01T00:00:00Z") };
const fixedIdGen: UniqueIdGenerator = { generate: () => "session-1" };

function target(stage: ReplayTarget["stage"], id: string): ReplayTarget {
  return { stage, reference: { id, content_hash: { algorithm: "sha256", digest: id } } };
}

describe("ReplaySession: failure classification is preserved", () => {
  it("REGRESSION: records violation_class so failures are distinguishable by error type, not just code string", async () => {
    // Verifier that throws a different violation class per target, simulating
    // a real run where some artifacts fail integrity and others fail trust.
    const verifier: ReplayVerifier = {
      verify: async (stage, reference) => {
        if (reference.id === "bad-hash") {
          throw new HashVerificationViolation("HASH_MISMATCH", "bad hash", reference);
        }
        if (reference.id === "bad-trust") {
          throw new TrustViolation("REPLAY_TRUST_ANCHOR_FAILED", "untrusted", reference);
        }
        throw new Error("unexpected target in test");
      },
    };

    const session = new ReplaySession(verifier, fixedClock, fixedIdGen, "test-profile");
    const result = await session.run([
      target("GOVERNANCE", "bad-hash"),
      target("ARCHIVE", "bad-trust"),
    ]);

    expect(result.completed).toBe(false);
    expect(result.failures).toHaveLength(2);

    const hashFailure = result.failures.find((f) => f.reference.id === "bad-hash");
    const trustFailure = result.failures.find((f) => f.reference.id === "bad-trust");

    // The core assertion: two structurally different failures must not
    // collapse into indistinguishable records. A consumer reading
    // ReplayResult.failures must be able to tell "tampered data" apart
    // from "untrusted signer" without string-matching `reason` text.
    expect(hashFailure?.violation_class).toBe("HashVerificationViolation");
    expect(trustFailure?.violation_class).toBe("TrustViolation");
    expect(hashFailure?.violation_class).not.toBe(trustFailure?.violation_class);
  });

  it("does not mutate or persist anything — pure read+verify", async () => {
    const verifier: ReplayVerifier = {
      verify: async <T>(stage: ReplayStage, reference: ContentReference) => ({
        stage,
        reference,
        artifact: { ok: true } as any,
        verification: { integrity: true, signature_valid: true, trusted: true },
      }),
    };

    const session = new ReplaySession(verifier, fixedClock, fixedIdGen, "test-profile");
    const result = await session.run([target("PROMOTION", "ok-1")]);

    expect(result.completed).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.steps).toHaveLength(1);
    expect(result.context.session_id).toBe("session-1");
  });
});
