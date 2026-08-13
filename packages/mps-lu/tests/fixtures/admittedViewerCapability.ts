import { admitViewerCapability } from "../../../mps-governance-runtime/src/ViewerCapabilityAdmission";
import type { ViewerCapabilityArtifact } from "../../../mps-compliance/src/artifacts/ViewerCapabilityArtifact";
import type { ViewerIdentityArtifact } from "../../../mps-compliance/src/artifacts/ViewerIdentityArtifact";

/**
 * F8 — VIEWER CAPABILITY ADMISSION FIXTURE.
 *
 * The viewer fixtures used to hand-construct `{ artifact_id, artifact_type, release_hash } as any`
 * and hand it straight to `ViewerKernel`. That capability had no `viewer_identity_ref`, no
 * `granted_by`, no `policy_ref` and no validity window — it was a root of trust invented by the
 * test, which is precisely what VIEW-22-I2 exists to prevent.
 *
 * This builder runs the REAL admission gate (`admitViewerCapability`) and throws on rejection,
 * so an inadmissible capability cannot reach a ViewerKernel from these tests at all. The
 * capability is a governance product here, not a test literal.
 */

export const VIEWER_RELEASE_HASH = "b".repeat(64);

export const VIEWER_IDENTITY: ViewerIdentityArtifact = {
  artifact_id: "viewer-identity-lu-1",
  artifact_type: "viewer_identity",
  content_hash: { algorithm: "sha256", value: "hash-viewer-identity-lu-1" },
  references: [],
  viewer_name: "LU Granskare",
  internal_subject_id: "sso|lu-granskare-1",
} as ViewerIdentityArtifact;

/**
 * Builds a capability and admits it. Returns only what the gate accepted.
 *
 * `now` is injectable because the gate enforces a temporal window; a fixture that silently
 * depended on wall-clock time would be a latent flake.
 */
export function buildAdmittedViewerCapability(
  scope: string,
  now: Date = new Date("2026-08-13T12:00:00.000Z"),
): ViewerCapabilityArtifact {
  const capability: ViewerCapabilityArtifact = {
    artifact_id: `viewer-cap-${scope}`,
    artifact_type: "viewer_capability",
    content_hash: { algorithm: "sha256", value: `hash-viewer-cap-${scope}` },
    references: [],
    viewer_identity_ref: {
      artifact_id: VIEWER_IDENTITY.artifact_id,
      artifact_type: "viewer_identity",
    },
    granted_by: { artifact_id: "grant-lu-viewer-1", artifact_type: "capability_grant" },
    policy_ref: { artifact_id: "policy-lu-viewer-1", artifact_type: "policy" },
    release_hash: { algorithm: "sha256", value: VIEWER_RELEASE_HASH },
    valid_from: "2026-01-01T00:00:00.000Z",
    valid_until: "2027-01-01T00:00:00.000Z",
    can_view_domain_evidence: true,
    allowed_operations: ["inspect", "export", "resolve_proof"],
    denied_operations: [],
  } as ViewerCapabilityArtifact;

  const admission = admitViewerCapability(capability, {
    expected_release_hash: VIEWER_RELEASE_HASH,
    now,
  });

  if (!admission.ok) {
    throw new Error(`F8 fixture is inadmissible: ${admission.reason}`);
  }

  return admission.capability;
}
