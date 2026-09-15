import { describe, expect, it } from "vitest";
import type { ArtifactContract } from "../src/artifacts/ArtifactContract";
import type { ArtifactReference } from "../src/artifacts/ArtifactReference";
import { ACT_21_I1 } from "../src/validators/ACT_21_I1";
import type { ValidationContext } from "../src/conformance/ValidationContext";

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

function context(artifacts: ArtifactContract[]): ValidationContext {
  const byId = new Map(artifacts.map((item) => [item.artifact_id, item]));
  return {
    artifacts,
    resolve(reference: ArtifactReference) {
      const artifact = byId.get(reference.artifact_id);
      return artifact?.artifact_type === reference.artifact_type ? artifact : undefined;
    },
  };
}

describe("ACT-21-I1 — Canonical Actor Identity", () => {
  it("passes when actor identity resolves and its pinned hash matches", () => {
    const identity = artifact("identity-1", "identity", "a".repeat(64));
    const actor = artifact("actor-1", "actor", "b".repeat(64), {
      identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
      identity_hash: identity.content_hash,
    });

    const result = ACT_21_I1.validate(context([identity, actor]));
    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.observation).toContain("resolves");
  });

  it("fails closed when an actor has no canonical identity reference", () => {
    const actor = artifact("actor-1", "actor", "b".repeat(64));

    const result = ACT_21_I1.validate(context([actor]));
    expect(result.passed).toBe(false);
  });

  it("fails closed when the actor identity hash does not match the resolved identity", () => {
    const identity = artifact("identity-1", "identity", "a".repeat(64));
    const actor = artifact("actor-1", "actor", "b".repeat(64), {
      identity_ref: { artifact_id: identity.artifact_id, artifact_type: identity.artifact_type },
      identity_hash: { algorithm: "sha256", value: "f".repeat(64) },
    });

    const result = ACT_21_I1.validate(context([identity, actor]));
    expect(result.passed).toBe(false);
  });
});
