import { describe, it, expect } from "vitest";
import {
  assertObservationMayNotWrite,
  assertAllowedObservationWrite,
} from "../src/ObservationWriteGate.js";
import { AUTHORITY_ARTIFACT_TYPES } from "../src/authorityTypes.js";
import { DefaultCanonicalPipeline } from "../../mps-canonical/src/CanonicalPipeline.js";
import { GovernanceRuntime } from "../src/GovernanceRuntime.js";
import { makeCapability, memoryReader, RELEASE_HASH, sha } from "./helpers.js";

describe("GOVERNANCE-22.9-I13 Observation ≠ Authority", () => {
  it("blocks every authority artifact type", () => {
    for (const t of AUTHORITY_ARTIFACT_TYPES) {
      expect(() => assertObservationMayNotWrite(t)).toThrow(/REJECT_OBSERVATION_AUTHORITY/);
    }
  });

  it("allows only session/proof/export observation products", () => {
    expect(() => assertAllowedObservationWrite("audit_session")).not.toThrow();
    expect(() => assertAllowedObservationWrite("proof_resolution")).not.toThrow();
    expect(() => assertAllowedObservationWrite("export_request")).not.toThrow();
    expect(() => assertAllowedObservationWrite("geojson_projection")).toThrow(
      /REJECT_OBSERVATION_WRITE/,
    );
  });

  it("runtime refuseAuthorityWrite never succeeds for decision/approval", () => {
    const runtime = new GovernanceRuntime({
      reader: memoryReader([]),
      canonicalPipeline: new DefaultCanonicalPipeline(),
      release_hash: RELEASE_HASH,
    });

    expect(() => runtime.refuseAuthorityWrite("decision")).toThrow(
      /REJECT_OBSERVATION_AUTHORITY/,
    );
    expect(() => runtime.refuseAuthorityWrite("approval")).toThrow(
      /REJECT_OBSERVATION_AUTHORITY/,
    );
  });

  it("session lifecycle does not admit a second concurrent capability (VIEW-22-I6)", () => {
    const runtime = new GovernanceRuntime({
      reader: memoryReader([]),
      canonicalPipeline: new DefaultCanonicalPipeline(),
      release_hash: RELEASE_HASH,
    });

    runtime.startSession({
      session_id: "s1",
      content_hash: sha("s1"),
      release_ref: {
        artifact_id: "release-1",
        artifact_type: "frozen_core_release_manifest",
      },
      capability: makeCapability(),
    });

    expect(() =>
      runtime.startSession({
        session_id: "s2",
        content_hash: sha("s2"),
        release_ref: {
          artifact_id: "release-1",
          artifact_type: "frozen_core_release_manifest",
        },
        capability: makeCapability({ artifact_id: "cap-2" }),
      }),
    ).toThrow(/REJECT_CAPABILITY_UNION/);
  });
});
