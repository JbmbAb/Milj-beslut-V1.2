import type { ViewerCapabilityArtifact } from "../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";

export type CapabilityAdmissionResult =
  | { readonly ok: true; readonly capability: ViewerCapabilityArtifact }
  | { readonly ok: false; readonly reason: string };

function hashValue(hash: ContentHash | string | undefined): string | undefined {
  if (hash == null) return undefined;
  if (typeof hash === "string") return hash;
  return hash.value;
}

/**
 * Admit a single ViewerCapabilityArtifact for an observation session.
 * Enforces VIEW-22-I2 (provenance) and temporal validity.
 */
export function admitViewerCapability(
  capability: ViewerCapabilityArtifact,
  opts: {
    readonly expected_release_hash: string;
    readonly now?: Date;
  },
): CapabilityAdmissionResult {
  if (capability.artifact_type !== "viewer_capability") {
    return { ok: false, reason: "REJECT_CAPABILITY_TYPE: expected viewer_capability" };
  }

  if (!capability.viewer_identity_ref?.artifact_id) {
    return { ok: false, reason: "REJECT_CAPABILITY_PROVENANCE: missing viewer_identity_ref" };
  }
  if (!capability.granted_by?.artifact_id) {
    return { ok: false, reason: "REJECT_CAPABILITY_PROVENANCE: missing granted_by" };
  }
  if (!capability.policy_ref?.artifact_id) {
    return { ok: false, reason: "REJECT_CAPABILITY_PROVENANCE: missing policy_ref" };
  }

  const release = hashValue(capability.release_hash);
  if (!release) {
    return { ok: false, reason: "REJECT_CAPABILITY_RELEASE: missing release_hash" };
  }
  if (release !== opts.expected_release_hash) {
    return {
      ok: false,
      reason: `REJECT_CAPABILITY_RELEASE: capability release ${release} != expected ${opts.expected_release_hash}`,
    };
  }

  const now = opts.now ?? new Date();
  const from = Date.parse(capability.valid_from);
  const until = Date.parse(capability.valid_until);
  if (Number.isNaN(from) || Number.isNaN(until)) {
    return { ok: false, reason: "REJECT_CAPABILITY_WINDOW: invalid valid_from/valid_until" };
  }
  if (until <= from) {
    return { ok: false, reason: "REJECT_CAPABILITY_WINDOW: valid_until must be after valid_from" };
  }
  if (now.getTime() < from) {
    return { ok: false, reason: "REJECT_CAPABILITY_WINDOW: not yet valid" };
  }
  if (now.getTime() > until) {
    return { ok: false, reason: "REJECT_CAPABILITY_WINDOW: expired" };
  }

  return { ok: true, capability };
}
