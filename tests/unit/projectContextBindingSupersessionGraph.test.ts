import { describe, expect, it } from "vitest";
import {
  createProjectContextBindingArtifact,
  createProjectContextBindingSupersessionArtifact,
  resolveCurrentProjectContextBindingHead,
} from "@miljobeslut/mps-lu";

const issuer = { artifact_id: "issuer", artifact_type: "project_context_binding_issuer" } as const;
const property = { artifact_id: "property", artifact_type: "project_property_binding" } as const;
function binding(context: string) {
  return createProjectContextBindingArtifact({
    project_id: "project-a", project_context_ref: { artifact_id: context, artifact_type: "LU_PROJECT_CONTEXT" },
    project_property_binding_ref: property, binding_version: "v1", authority_ref: issuer, created_at: "2026-08-21T00:00:00.000Z",
  });
}
function relation(from: ReturnType<typeof binding>, to: ReturnType<typeof binding>) {
  return createProjectContextBindingSupersessionArtifact({
    contract_version: "PROJECT_CONTEXT_BINDING_SUPERSESSION_V1", project_id: "project-a",
    superseded_binding_ref: { artifact_id: from.artifact_id, artifact_type: from.artifact_type },
    successor_binding_ref: { artifact_id: to.artifact_id, artifact_type: to.artifact_type },
    reason_code: "CORRECTION", issuer_ref: issuer, issuer_key_id: "issuer-key", issued_at: "2026-08-21T00:00:00.000Z",
  });
}

describe("PROJECT-CONTEXT-BINDING-SUPERSESSION-V1", () => {
  it("chooses the successor independent of input order", () => {
    const oldBinding = binding("context-old"); const corrected = binding("context-corrected");
    expect(resolveCurrentProjectContextBindingHead({ projectId: "project-a", bindings: [corrected, oldBinding], supersessions: [relation(oldBinding, corrected)] }).artifact_id).toBe(corrected.artifact_id);
  });
  it("fails closed for two bindings without a relation", () => {
    expect(() => resolveCurrentProjectContextBindingHead({ projectId: "project-a", bindings: [binding("a"), binding("b")], supersessions: [] })).toThrow("ambiguous head");
  });
  it("fails closed for a fork, cycle, and cross-project relation", () => {
    const a = binding("a"); const b = binding("b"); const c = binding("c");
    expect(() => resolveCurrentProjectContextBindingHead({ projectId: "project-a", bindings: [a, b, c], supersessions: [relation(a, b), relation(a, c)] })).toThrow("fork");
    expect(() => resolveCurrentProjectContextBindingHead({ projectId: "project-a", bindings: [a, b], supersessions: [relation(a, b), relation(b, a)] })).toThrow("cycle");
    const wrong = { ...relation(a, b), payload: { ...relation(a, b).payload, project_id: "project-b" } };
    expect(() => resolveCurrentProjectContextBindingHead({ projectId: "project-a", bindings: [a, b], supersessions: [wrong] })).toThrow("supersession project");
  });
});
