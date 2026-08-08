import { beforeEach, describe, it, expect } from "vitest";
import { DefaultCanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline.js";
import { GovernanceRuntime } from "../src/GovernanceRuntime.js";
import {
  leafArtifact,
  makeCapability,
  memoryReader,
  RELEASE_HASH,
  sha,
} from "./helpers.js";

describe("GovernanceRuntime Phase 23B", () => {
  const releaseRef = {
    artifact_id: "release-1",
    artifact_type: "frozen_core_release_manifest",
  };

  let pipeline: DefaultCanonicalPipeline;

  beforeEach(async () => {
    pipeline = new DefaultCanonicalPipeline();
    await pipeline.initHasher();
  });

  it("opens session, inspects, resolves proof without completeness on leaf, closes", () => {
    const leaf = leafArtifact("leaf-1");
    const runtime = new GovernanceRuntime({
      reader: memoryReader([leaf]),
      canonicalPipeline: pipeline,
      release_hash: RELEASE_HASH,
    });

    const opened = runtime.startSession({
      session_id: "sess-live-1",
      content_hash: sha("sess-live-1"),
      release_ref: releaseRef,
      capability: makeCapability(),
    });
    expect(opened.state).toBe("OPEN");
    expect(runtime.getActiveCapabilityId()).toBe("cap-1");

    runtime.inspect({ artifact_id: "leaf-1", artifact_type: "domain_evidence" });

    const proof = runtime.resolveProofPath({
      target: { artifact_id: "leaf-1", artifact_type: "domain_evidence" },
      question: "approval_reason",
      validate_completeness: false,
    });
    expect(proof.resolution.artifact_type).toBe("proof_resolution");
    expect(proof.resolution.created_by.artifact_id).toBe("sess-live-1");
    expect(proof.graph.nodes.length).toBeGreaterThanOrEqual(1);

    const closed = runtime.closeSession();
    expect(closed.state).toBe("CLOSED");
    expect(closed.inspected_nodes.some((n) => n.artifact_id === "leaf-1")).toBe(true);
    expect(runtime.getActiveCapabilityId()).toBeNull();
  });

  it("rejects startSession with expired capability", () => {
    const runtime = new GovernanceRuntime({
      reader: memoryReader([]),
      canonicalPipeline: pipeline,
      release_hash: RELEASE_HASH,
    });

    expect(() =>
      runtime.startSession({
        session_id: "sess-x",
        content_hash: sha("sess-x"),
        release_ref: releaseRef,
        capability: makeCapability({
          valid_until: "2020-06-01T00:00:00.000Z",
        }),
        now: new Date("2026-08-08T00:00:00.000Z"),
      }),
    ).toThrow(/expired/);
  });

  it("rejects undeclared proof question via resolver", () => {
    const leaf = leafArtifact("leaf-2");
    const runtime = new GovernanceRuntime({
      reader: memoryReader([leaf]),
      canonicalPipeline: pipeline,
      release_hash: RELEASE_HASH,
    });

    runtime.startSession({
      session_id: "sess-q",
      content_hash: sha("sess-q"),
      release_ref: releaseRef,
      capability: makeCapability(),
    });

    expect(() =>
      runtime.resolveProofPath({
        target: { artifact_id: "leaf-2", artifact_type: "domain_evidence" },
        question: "semantic_search" as any,
        validate_completeness: false,
      }),
    ).toThrow(/REJECT_UNDECLARED_PROOF_QUERY/);
  });
});