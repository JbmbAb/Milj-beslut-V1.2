import { createHash } from "node:crypto";

/**
 * LU Site Assessment workflow + capability registry snapshot (Fas 3).
 * Real content hashes — not mock-*-hash.
 */
export const LU_SITE_ASSESSMENT_CAPABILITY_KEY = "lu.site_assessment" as const;
export const LU_SITE_ASSESSMENT_WORKFLOW_KEY = "lu.site_assessment.workflow" as const;

function sha256(value: unknown): { algorithm: "sha256"; value: string } {
  return {
    algorithm: "sha256",
    value: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

export const LU_CAPABILITY_DEFINITION = {
  artifact_id: "cap-lu-site-assessment-v1",
  artifact_type: "CAPABILITY_DEFINITION" as const,
  capability_key: LU_SITE_ASSESSMENT_CAPABILITY_KEY,
  capability_version: "1.0.0",
  implementation_ref: { artifact_id: "impl-lu-rule-engine-v1" },
  input_types: ["SPATIAL_EVIDENCE"],
  output_types: ["localization_assessment"],
};

export const LU_WORKFLOW_DEFINITION = {
  artifact_id: "wf-lu-site-assessment-v1",
  artifact_type: "WORKFLOW_DEFINITION" as const,
  workflow_key: LU_SITE_ASSESSMENT_WORKFLOW_KEY,
  workflow_version: "1.0.0",
  steps: [
    {
      step_id: "resolve_property",
      capability_ref: { artifact_id: "cap-lu-site-assessment-v1" },
    },
    {
      step_id: "spatial_query",
      capability_ref: { artifact_id: "cap-lu-site-assessment-v1" },
    },
    {
      step_id: "assess",
      capability_ref: { artifact_id: "cap-lu-site-assessment-v1" },
    },
  ],
};

export const LU_REGISTRY_SNAPSHOT = {
  snapshot_id: "lu-registry-snapshot-v1",
  registry_hash: sha256({
    capabilities: [LU_CAPABILITY_DEFINITION.artifact_id],
    workflows: [LU_WORKFLOW_DEFINITION.artifact_id],
  }),
  capabilities: [LU_CAPABILITY_DEFINITION],
  workflows: [LU_WORKFLOW_DEFINITION],
  content_hash: sha256({
    cap: LU_CAPABILITY_DEFINITION,
    wf: LU_WORKFLOW_DEFINITION,
  }),
};

export const LU_CAPABILITY_DEFINITION_HASH = sha256(LU_CAPABILITY_DEFINITION);
export const LU_WORKFLOW_DEFINITION_HASH = sha256(LU_WORKFLOW_DEFINITION);
