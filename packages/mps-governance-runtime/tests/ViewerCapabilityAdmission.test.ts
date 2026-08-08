import { describe, it, expect } from "vitest";
import { admitViewerCapability } from "../src/ViewerCapabilityAdmission.js";
import { makeCapability, RELEASE_HASH, sha } from "./helpers.js";

describe("ViewerCapabilityAdmission (VIEW-22-I2)", () => {
  it("admits a valid capability for the expected release", () => {
    const result = admitViewerCapability(makeCapability(), {
      expected_release_hash: RELEASE_HASH,
      now: new Date("2026-08-08T00:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects missing provenance", () => {
    const result = admitViewerCapability(
      makeCapability({
        viewer_identity_ref: { artifact_id: "", artifact_type: "viewer_identity" },
      }),
      { expected_release_hash: RELEASE_HASH },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("viewer_identity_ref");
  });

  it("rejects wrong release", () => {
    const result = admitViewerCapability(makeCapability(), {
      expected_release_hash: "b".repeat(64),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("REJECT_CAPABILITY_RELEASE");
  });

  it("rejects expired capability", () => {
    const result = admitViewerCapability(
      makeCapability({
        valid_from: "2020-01-01T00:00:00.000Z",
        valid_until: "2021-01-01T00:00:00.000Z",
        release_hash: sha(RELEASE_HASH),
      }),
      {
        expected_release_hash: RELEASE_HASH,
        now: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("expired");
  });
});
