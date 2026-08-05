/**
 * Projection Runtime — Epoch II §2.7.
 *
 * Execution → Artifacts → Projection → UI
 *
 * Read-only facade over ArtifactResolverPort.
 * MUST NOT put / mutate CAS. Same refs → same projection_hash.
 */

import type { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import type { ArtifactResolverPort } from "../mimers/ArtifactResolver.js";
import type {
  ArtifactProjectionView,
  ProjectionBatchView,
} from "./ProjectionContracts.js";
import { PROJECTION_RUNTIME_VERSION } from "./ProjectionContracts.js";

export type ProjectionRuntimeOptions = {
  readonly resolver: ArtifactResolverPort;
};

/**
 * Sole platform surface for deriving UI/audit views from immutable artifacts.
 */
export class ProjectionRuntime {
  private readonly resolver: ArtifactResolverPort;

  private constructor(resolver: ArtifactResolverPort) {
    this.resolver = resolver;
  }

  static create(options: ProjectionRuntimeOptions): ProjectionRuntime {
    if (!options.resolver) {
      throw new Error("ProjectionRuntime: resolver is required");
    }
    return new ProjectionRuntime(options.resolver);
  }

  get version(): typeof PROJECTION_RUNTIME_VERSION {
    return PROJECTION_RUNTIME_VERSION;
  }

  /**
   * Project one artifact ref into a read-only view.
   * Fail-closed if artifact missing from CAS.
   */
  async project(ref: ArtifactReference): Promise<ArtifactProjectionView> {
    const envelope = await this.resolver.resolveEnvelope<unknown>(ref);
    const artifact_type = inferArtifactType(envelope.body, ref.artifact_type);

    const canonical = {
      artifact_id: envelope.artifact_id,
      artifact_type,
      content_hash: envelope.content_hash,
      body: envelope.body,
    };

    return Object.freeze({
      projection_kind: "artifact" as const,
      artifact_id: envelope.artifact_id,
      artifact_type,
      content_hash: envelope.content_hash,
      body: deepFreezeClone(envelope.body),
      projection_hash: sha256ContentHash(canonical),
    });
  }

  async projectMany(
    refs: readonly ArtifactReference[],
  ): Promise<ProjectionBatchView> {
    const views: ArtifactProjectionView[] = [];
    for (const ref of refs) {
      views.push(await this.project(ref));
    }
    const frozenViews = Object.freeze([...views]);
    return Object.freeze({
      projection_kind: "batch" as const,
      views: frozenViews,
      batch_hash: sha256ContentHash({
        ids: frozenViews.map((v) => v.artifact_id),
        hashes: frozenViews.map((v) => v.projection_hash.value),
      }),
    });
  }
}

function inferArtifactType(
  body: unknown,
  refType: string | undefined,
): string | null {
  if (
    body &&
    typeof body === "object" &&
    "artifact_type" in body &&
    typeof (body as { artifact_type: unknown }).artifact_type === "string"
  ) {
    return (body as { artifact_type: string }).artifact_type;
  }
  return refType ?? null;
}

/** Structural clone + freeze so callers cannot mutate projected body. */
function deepFreezeClone(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeClone(item)));
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = deepFreezeClone(nested);
  }
  return Object.freeze(out);
}
