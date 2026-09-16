import { describe, expect, it } from "vitest";
import type { ArtifactContract } from "../src/artifacts/ArtifactContract";
import type { ArtifactReference } from "../src/artifacts/ArtifactReference";
import type { ValidationContext } from "../src/conformance/ValidationContext";
import { ACT_21_I3 } from "../src/validators/ACT_21_I3";
import { ACT_21_I5 } from "../src/validators/ACT_21_I5";

function artifact(
  artifact_id: string,
  artifact_type: string,
  hash: string,
  extra: Record<string, unknown> = {},
): ArtifactContract {
  return {
    artifact_id,
    artifact_type,
    content_hash: { algorithm: "sha256", value: hash },
    references: [],
    ...extra,
  } as ArtifactContract;
}

function ref(artifact: ArtifactContract): ArtifactReference {
  return {
    artifact_id: artifact.artifact_id,
    artifact_type: artifact.artifact_type,
  };
}

function context(artifacts: ArtifactContract[]): ValidationContext {
  const byId = new Map(artifacts.map((item) => [item.artifact_id, item]));
  return {
    artifacts,
    resolve(reference: ArtifactReference) {
      const candidate = byId.get(reference.artifact_id);
      return candidate?.artifact_type === reference.artifact_type ? candidate : undefined;
    },
  };
}

function trustFixture() {
  const root = artifact("actor-root", "actor", "1".repeat(64));
  const user = artifact("actor-user", "actor", "2".repeat(64));
  const mid = artifact("actor-mid", "actor", "3".repeat(64));

  const anchor = artifact("anchor-1", "trust_anchor", "4".repeat(64), {
    root_actor_ref: ref(root),
    root_actor_hash: root.content_hash,
  });
  const domain = artifact("domain-1", "trust_domain", "5".repeat(64), {
    anchor_ref: ref(anchor),
    domain_name: "production",
  });

  const actor = artifact("actor-subject", "actor", "6".repeat(64), {
    trust_domain_ref: ref(domain),
  });

  const direct = artifact("delegation-direct", "trust_delegation", "7".repeat(64), {
    from_actor_ref: ref(root),
    to_actor_ref: ref(user),
    domain_ref: ref(domain),
    authority_scope: "production",
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2027-01-01T00:00:00.000Z",
  });

  return { root, user, mid, anchor, domain, actor, direct };
}

describe("ACT-21-I3 — trust-domain participation", () => {
  it("accepts a domain participant plus a hash-bound root actor with no self-domain reference", () => {
    const f = trustFixture();
    const result = ACT_21_I3.validate(
      context([f.root, f.anchor, f.domain, f.actor]),
    );
    expect(result.passed).toBe(true);
    expect(
      result.evidence.some(
        (entry) =>
          entry.artifact_ref.artifact_id === f.root.artifact_id &&
          entry.observation.includes("hash-bound trust-anchor root"),
      ),
    ).toBe(true);
  });

  it("fails closed when the claimed root actor hash does not bind to the resolved root", () => {
    const f = trustFixture();
    const badAnchor = artifact("anchor-1", "trust_anchor", "4".repeat(64), {
      root_actor_ref: ref(f.root),
      root_actor_hash: { algorithm: "sha256", value: "f".repeat(64) },
    });
    const result = ACT_21_I3.validate(
      context([f.root, badAnchor, f.domain, f.actor]),
    );
    expect(result.passed).toBe(false);
  });

  it("fails instead of vacuously passing when no actor/domain subject exists", () => {
    expect(ACT_21_I3.validate(context([])).passed).toBe(false);
  });

  it("fails a non-root actor that has no resolvable trust-domain participation", () => {
    const f = trustFixture();
    const orphan = artifact("actor-orphan", "actor", "b".repeat(64));
    const result = ACT_21_I3.validate(
      context([f.root, f.anchor, f.domain, orphan]),
    );
    expect(result.passed).toBe(false);
  });
});

describe("ACT-21-I5 — deterministic delegation graph", () => {
  it("accepts a unique acyclic root path", () => {
    const f = trustFixture();
    const result = ACT_21_I5.validate(
      context([f.root, f.user, f.anchor, f.domain, f.direct]),
    );
    expect(result.passed).toBe(true);
  });

  it("rejects two distinct root paths to the same actor when their validity overlaps", () => {
    const f = trustFixture();
    const rootMid = artifact("delegation-root-mid", "trust_delegation", "8".repeat(64), {
      from_actor_ref: ref(f.root),
      to_actor_ref: ref(f.mid),
      domain_ref: ref(f.domain),
      authority_scope: "production",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2027-01-01T00:00:00.000Z",
    });
    const midUser = artifact("delegation-mid-user", "trust_delegation", "9".repeat(64), {
      from_actor_ref: ref(f.mid),
      to_actor_ref: ref(f.user),
      domain_ref: ref(f.domain),
      authority_scope: "production",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2027-01-01T00:00:00.000Z",
    });

    const result = ACT_21_I5.validate(
      context([
        f.root,
        f.user,
        f.mid,
        f.anchor,
        f.domain,
        f.direct,
        rootMid,
        midUser,
      ]),
    );
    expect(result.passed).toBe(false);
    expect(
      result.evidence.some((entry) => entry.observation.includes("multiple root paths")),
    ).toBe(true);
  });

  it("accepts parallel historical/future delegations that can never be active at the same T_decision", () => {
    const f = trustFixture();
    const historical = artifact(
      "delegation-historical",
      "trust_delegation",
      "c".repeat(64),
      {
        from_actor_ref: ref(f.root),
        to_actor_ref: ref(f.user),
        domain_ref: ref(f.domain),
        authority_scope: "production",
        valid_from: "2025-01-01T00:00:00.000Z",
        valid_until: "2026-01-01T00:00:00.000Z",
      },
    );
    const future = artifact(
      "delegation-future",
      "trust_delegation",
      "d".repeat(64),
      {
        from_actor_ref: ref(f.root),
        to_actor_ref: ref(f.user),
        domain_ref: ref(f.domain),
        authority_scope: "production",
        valid_from: "2027-01-01T00:00:00.000Z",
        valid_until: "2028-01-01T00:00:00.000Z",
      },
    );

    const result = ACT_21_I5.validate(
      context([f.root, f.user, f.anchor, f.domain, historical, future]),
    );
    expect(result.passed).toBe(true);
  });

  it("rejects a root-reachable cycle when the cycle can be active at one instant", () => {
    const f = trustFixture();
    const back = artifact("delegation-user-root", "trust_delegation", "a".repeat(64), {
      from_actor_ref: ref(f.user),
      to_actor_ref: ref(f.root),
      domain_ref: ref(f.domain),
      authority_scope: "production",
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2027-01-01T00:00:00.000Z",
    });

    const result = ACT_21_I5.validate(
      context([f.root, f.user, f.anchor, f.domain, f.direct, back]),
    );
    expect(result.passed).toBe(false);
    expect(
      result.evidence.some((entry) => entry.observation.includes("cycle")),
    ).toBe(true);
  });

  it("does not report a temporal cycle when the return edge never overlaps the forward path", () => {
    const f = trustFixture();
    const forward = artifact(
      "delegation-forward-old",
      "trust_delegation",
      "e".repeat(64),
      {
        from_actor_ref: ref(f.root),
        to_actor_ref: ref(f.user),
        domain_ref: ref(f.domain),
        authority_scope: "production",
        valid_from: "2025-01-01T00:00:00.000Z",
        valid_until: "2026-01-01T00:00:00.000Z",
      },
    );
    const returnEdge = artifact(
      "delegation-return-new",
      "trust_delegation",
      "f".repeat(64),
      {
        from_actor_ref: ref(f.user),
        to_actor_ref: ref(f.root),
        domain_ref: ref(f.domain),
        authority_scope: "production",
        valid_from: "2026-01-01T00:00:00.000Z",
        valid_until: "2027-01-01T00:00:00.000Z",
      },
    );

    const result = ACT_21_I5.validate(
      context([f.root, f.user, f.anchor, f.domain, forward, returnEdge]),
    );
    expect(result.passed).toBe(true);
  });

  it("fails instead of vacuously passing when no trust-domain subject exists", () => {
    expect(ACT_21_I5.validate(context([])).passed).toBe(false);
  });

  it("fails closed on a trust-anchor root hash mismatch", () => {
    const f = trustFixture();
    const badAnchor = artifact("anchor-1", "trust_anchor", "4".repeat(64), {
      root_actor_ref: ref(f.root),
      root_actor_hash: { algorithm: "sha256", value: "0".repeat(64) },
    });
    const result = ACT_21_I5.validate(
      context([f.root, f.user, badAnchor, f.domain, f.direct]),
    );
    expect(result.passed).toBe(false);
  });
});
