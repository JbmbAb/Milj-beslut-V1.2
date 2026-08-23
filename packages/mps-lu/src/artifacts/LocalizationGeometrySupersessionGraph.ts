import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { LocalizationGeometryArtifact } from "./LocalizationGeometryArtifact";
import type { LocalizationGeometrySupersessionArtifact } from "./LocalizationGeometrySupersessionArtifact";

const key = (r: ArtifactReference) => `${r.artifact_type}:${r.artifact_id}`;

/**
 * Pure, order-independent authority reduction -- deliberately the same shape as
 * resolveCurrentProjectContextBindingHead (packages/mps-lu/src/artifacts/
 * ProjectContextBindingSupersessionGraph.ts), duplicated rather than shared so this file has no
 * dependency on the binding graph's module. `createdAt` and artifact-id lexical order play no
 * role anywhere in this function -- currentness is purely "the one geometry with no outgoing
 * supersession edge." Callers must verify every artifact (both geometries and supersessions)
 * before calling this -- it trusts its inputs completely.
 */
export function resolveCurrentLocalizationGeometryHead(args: {
  readonly projectId: string;
  readonly geometries: readonly LocalizationGeometryArtifact[];
  readonly supersessions: readonly LocalizationGeometrySupersessionArtifact[];
}): LocalizationGeometryArtifact {
  const geometries = new Map(args.geometries.map((g) => [key({ artifact_id: g.artifact_id, artifact_type: g.artifact_type }), g]));
  if (geometries.size !== args.geometries.length || geometries.size === 0) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_HEAD: geometries");
  }
  for (const geometry of geometries.values()) {
    if (geometry.payload.project_id !== args.projectId) throw new Error("REJECT_LOCALIZATION_GEOMETRY_HEAD: geometry project");
  }

  const successorByPredecessor = new Map<string, string>();
  const predecessors = new Set<string>();
  for (const relation of args.supersessions) {
    if (relation.payload.project_id !== args.projectId) throw new Error("REJECT_LOCALIZATION_GEOMETRY_HEAD: supersession project");
    const from = key(relation.payload.predecessor_geometry_ref);
    const to = key(relation.payload.successor_geometry_ref);
    if (!geometries.has(from) || !geometries.has(to)) throw new Error("REJECT_LOCALIZATION_GEOMETRY_HEAD: missing relation geometry");
    if (successorByPredecessor.has(from) || predecessors.has(to)) {
      throw new Error("AMBIGUOUS_CURRENT_GEOMETRY: fork in localization geometry supersession graph");
    }
    successorByPredecessor.set(from, to);
    predecessors.add(to);
  }

  for (const start of geometries.keys()) {
    const seen = new Set<string>();
    let cursor: string | undefined = start;
    while (cursor) {
      if (seen.has(cursor)) throw new Error("INVALID_SUPERSESSION_GRAPH: cycle in localization geometry supersession graph");
      seen.add(cursor);
      cursor = successorByPredecessor.get(cursor);
    }
  }

  const heads = [...geometries.keys()].filter((k) => !successorByPredecessor.has(k));
  if (heads.length === 0) throw new Error("REJECT_LOCALIZATION_GEOMETRY_HEAD: no head (should be unreachable if cycle check passed)");
  if (heads.length !== 1) throw new Error("AMBIGUOUS_CURRENT_GEOMETRY: multiple localization geometry heads");
  return geometries.get(heads[0]!)!;
}
