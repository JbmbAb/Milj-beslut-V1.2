import { ExecutionPlanArtifact } from "../../execution/ExecutionPlanArtifact";
import { ExecutionManifest } from "../../execution/ExecutionManifest";

export function createPfasDagPlan(manifest: ExecutionManifest): ExecutionPlanArtifact {
  return {
    plan_id: "plan-001",
    execution_manifest_ref: { id: "manifest1", version: "1", content_hash: manifest.identity.identity_hash },
    execution_identity_hash: manifest.identity.identity_hash,
    steps: [
      {
        step_id: "pfas-analyzer-step",
        description: "Analyze PFAS",
        inputs: [],
        outputs: [],
        capability_ref: { id: "capability.pfas.analyzer", version: "1", content_hash: { algorithm: "sha256-v1", digest: "cap-analyzer", bit_length: 256 } },
      },
      {
        step_id: "pfas-import-step",
        description: "Import PFAS",
        inputs: [],
        outputs: [],
        capability_ref: { id: "capability.pfas.import", version: "1", content_hash: { algorithm: "sha256-v1", digest: "cap-import", bit_length: 256 } },
      },
      {
        step_id: "pfas-normalize-step",
        description: "Normalize PFAS",
        inputs: [],
        outputs: [],
        capability_ref: { id: "capability.pfas.normalize", version: "1", content_hash: { algorithm: "sha256-v1", digest: "cap-normalize", bit_length: 256 } },
      }
    ],
    dependencies: [
      { from: "pfas-import-step", to: "pfas-normalize-step", type: "data" },
      { from: "pfas-normalize-step", to: "pfas-analyzer-step", type: "data" }
    ],
    planner: { id: "planner1", version: "1", content_hash: { algorithm: "sha256-v1", digest: "planner-hash", bit_length: 256 } },
    planner_version: "1.0",
    ordering_strategy: "topological",
    content_hash: { algorithm: "sha256-v1", digest: "plan-hash-123", bit_length: 256 },
    created_at: new Date().toISOString()
  } as any;
}
