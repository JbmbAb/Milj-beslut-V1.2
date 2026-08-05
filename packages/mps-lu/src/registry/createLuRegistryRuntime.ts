import {
  createRegistryRuntime,
  type RegistryRuntime,
} from "../../../mps-runtime/src/registry/index.js";
import {
  LU_CAPABILITY_DEFINITION,
  LU_REGISTRY_SNAPSHOT,
  LU_WORKFLOW_DEFINITION,
} from "./LuSiteAssessmentRegistry.js";

/**
 * Seeds platform RegistryRuntime from LU release constants.
 * Domain composition root only — ExecutionKernel never imports this.
 */
export function createLuRegistryRuntime(): RegistryRuntime {
  return createRegistryRuntime({
    snapshot_id: LU_REGISTRY_SNAPSHOT.snapshot_id,
    release_id: "lu-release-v1",
    capabilities: [
      {
        artifact_id: LU_CAPABILITY_DEFINITION.artifact_id,
        artifact_type: "CAPABILITY_DEFINITION",
        capability_key: LU_CAPABILITY_DEFINITION.capability_key,
        capability_version: LU_CAPABILITY_DEFINITION.capability_version,
        implementation_ref: LU_CAPABILITY_DEFINITION.implementation_ref,
        input_types: LU_CAPABILITY_DEFINITION.input_types,
        output_types: LU_CAPABILITY_DEFINITION.output_types,
      },
    ],
    workflows: [
      {
        artifact_id: LU_WORKFLOW_DEFINITION.artifact_id,
        artifact_type: "WORKFLOW_DEFINITION",
        workflow_key: LU_WORKFLOW_DEFINITION.workflow_key,
        workflow_version: LU_WORKFLOW_DEFINITION.workflow_version,
        steps: LU_WORKFLOW_DEFINITION.steps,
      },
    ],
    rules: [
      {
        artifact_id: "rule-lu-site-assessment-v1",
        artifact_type: "RULE_BINDING",
        rule_key: "lu.site_assessment.rules",
        binding_ref: { artifact_id: "impl-lu-rule-engine-v1" },
      },
    ],
    providers: [
      {
        artifact_id: "provider-lu-spatial-v1",
        artifact_type: "PROVIDER_BINDING",
        provider_key: "lu.spatial.postgis",
        provider_kind: "spatial",
        implementation_ref: { artifact_id: "impl-postgis-spatial-v1" },
      },
    ],
  });
}
