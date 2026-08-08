import { describe, it, expect } from "vitest";
import { AuditSessionRuntime } from "../src/AuditSessionRuntime.js";
import { makeCapability, sha } from "./helpers.js";

describe("AuditSessionRuntime (VIEW-22-I4/I5)", () => {
  const releaseRef = {
    artifact_id: "release-1",
    artifact_type: "frozen_core_release_manifest",
  };

  it("records inspect and export then closes", () => {
    const session = AuditSessionRuntime.open({
      session_id: "sess-1",
      content_hash: sha("sess-1"),
      release_ref: releaseRef,
      capability: makeCapability(),
    });

    session.inspect({ artifact_id: "n1", artifact_type: "domain_evidence" });
    session.recordExport({ artifact_id: "e1", artifact_type: "export_request" });
    const closed = session.close("2026-08-08T12:00:00.000Z");

    expect(closed.state).toBe("CLOSED");
    expect(closed.inspected_nodes).toHaveLength(1);
    expect(closed.exported_artifacts).toHaveLength(1);
    expect(closed.closed_at).toBe("2026-08-08T12:00:00.000Z");
  });

  it("enforces viewport budget on inspect", () => {
    const session = AuditSessionRuntime.open(
      {
        session_id: "sess-2",
        content_hash: sha("sess-2"),
        release_ref: releaseRef,
        capability: makeCapability(),
      },
      { max_inspected_nodes: 1, max_exported_artifacts: 10 },
    );

    session.inspect({ artifact_id: "n1", artifact_type: "domain_evidence" });
    expect(() =>
      session.inspect({ artifact_id: "n2", artifact_type: "domain_evidence" }),
    ).toThrow(/REJECT_VIEWPORT_EXCEEDED/);
  });

  it("rejects mutations after close", () => {
    const session = AuditSessionRuntime.open({
      session_id: "sess-3",
      content_hash: sha("sess-3"),
      release_ref: releaseRef,
      capability: makeCapability(),
    });
    session.close();
    expect(() =>
      session.inspect({ artifact_id: "n1", artifact_type: "domain_evidence" }),
    ).toThrow(/REJECT_SESSION_STATE/);
  });
});
