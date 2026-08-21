import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { ProjectContextBindingArtifact } from "./ProjectContextBindingArtifact";
import type { ProjectContextBindingSupersessionArtifact } from "./ProjectContextBindingSupersessionArtifact";

const key = (r: ArtifactReference) => `${r.artifact_type}:${r.artifact_id}`;

/** Pure, order-independent authority reduction. Callers must verify every artifact first. */
export function resolveCurrentProjectContextBindingHead(args: {
  readonly projectId: string;
  readonly bindings: readonly ProjectContextBindingArtifact[];
  readonly supersessions: readonly ProjectContextBindingSupersessionArtifact[];
}): ProjectContextBindingArtifact {
  const bindings = new Map(args.bindings.map((binding) => [key(binding), binding]));
  if (bindings.size !== args.bindings.length || bindings.size === 0) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: bindings");
  for (const binding of bindings.values()) if (binding.payload.project_id !== args.projectId) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: binding project");
  const successorByPredecessor = new Map<string, string>();
  const predecessors = new Set<string>();
  for (const relation of args.supersessions) {
    if (relation.payload.project_id !== args.projectId) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: supersession project");
    const from = key(relation.payload.superseded_binding_ref); const to = key(relation.payload.successor_binding_ref);
    if (!bindings.has(from) || !bindings.has(to)) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: missing relation binding");
    if (successorByPredecessor.has(from) || predecessors.has(to)) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: fork");
    successorByPredecessor.set(from, to); predecessors.add(to);
  }
  for (const start of bindings.keys()) { const seen = new Set<string>(); let cursor: string | undefined = start; while (cursor) { if (seen.has(cursor)) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: cycle"); seen.add(cursor); cursor = successorByPredecessor.get(cursor); } }
  const heads = [...bindings.keys()].filter((binding) => !successorByPredecessor.has(binding));
  if (heads.length !== 1) throw new Error("REJECT_PROJECT_CONTEXT_BINDING_HEAD: ambiguous head");
  return bindings.get(heads[0]!)!;
}
