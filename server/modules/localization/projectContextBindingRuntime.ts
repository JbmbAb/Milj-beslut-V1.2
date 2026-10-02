import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
  PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
  resolveCurrentProjectContextBindingHead,
  type LocalizationAssessmentArtifact,
  type ProjectContextBindingArtifact,
  type ProjectContextBindingArtifactV2,
  type ProjectContextBindingSupersessionArtifact,
  type ProjectContextBindingSupersessionArtifactV2,
  validateProjectContextBindingAnyVersion,
} from "@miljobeslut/mps-lu";

/** PROJECT-CONTEXT-BINDING-V2-PRODUCER-ADOPTION-01: every resolver in this class now returns
 *  either version -- the graph-resolution/currentness logic below is already version-agnostic
 *  (it only reads payload.project_id and ref identity, present identically on both), so mixed
 *  V1/V2 history resolves correctly with no further change. */
export type AnyProjectContextBindingArtifact = ProjectContextBindingArtifact | ProjectContextBindingArtifactV2;
type AnyProjectContextBindingSupersessionArtifact = ProjectContextBindingSupersessionArtifact | ProjectContextBindingSupersessionArtifactV2;
import type { ProjectContextBindingIndex } from "../../repositories/projectContextBindingRepository";
import { verifyProjectContextBindingArtifactAuthority, verifyProjectContextBindingSupersessionAuthority } from "./projectContextBindingAuthority";

/**
 * W-APR (OD-R2; U20CDF2 verifier H1, add-on 2): resolveCurrent's one refusal. The message is exactly
 * the REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE it always was, so every existing caller
 * behaves as before; what it now also carries lets a caller tell genuine absence from a fault:
 * `noBindingRegistered` is true only when the index lists no binding at all for the project, and
 * `cause` is the original failure (an unreadable index, a storage fault on a binding/issuer/relation,
 * or a verification refusal). It never selects a binding.
 *
 * W-BOOT (APR verifier F2): `noBindingRegistered` is true only when the index lists NEITHER a binding
 * NOR a supersession relation for the project. Supersession rows without any binding row prove lost
 * binding rows (the index is append-only and every relation names two bindings): the cause is then
 * ProjectContextBindingIndexInconsistentError, a lasting integrity fault -- never absence. Rows in
 * other indexes (assessment projection, geometry, bootstrap queue) are their owners' to check.
 */
export class ProjectContextBindingCurrentUnavailableError extends Error {
  readonly noBindingRegistered: boolean;

  constructor(noBindingRegistered: boolean, cause: unknown) {
    super("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE", { cause });
    this.name = "ProjectContextBindingCurrentUnavailableError";
    this.noBindingRegistered = noBindingRegistered;
  }
}

export const PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT = "PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT" as const;

/** W-BOOT (APR verifier F2): the binding index contradicts itself -- binding rows are lost. Lasting. */
export class ProjectContextBindingIndexInconsistentError extends Error {
  readonly code = PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT;

  constructor(detail: string) {
    super(`${PROJECT_CONTEXT_BINDING_INDEX_INCONSISTENT}: ${detail}`);
    this.name = "ProjectContextBindingIndexInconsistentError";
  }
}

export class ProjectContextBindingProvider {
  constructor(
    private readonly artifactRepository: ArtifactRepositoryPort,
    private readonly index: ProjectContextBindingIndex,
    private readonly verification: VerificationKeyProvider,
  ) {}

  async resolve(projectId: string, projectContextRef: ArtifactReference): Promise<AnyProjectContextBindingArtifact> {
    let bindingArtifactId: string;
    try {
      bindingArtifactId = await this.index.resolve(projectId, projectContextRef);
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
    }

    let binding: AnyProjectContextBindingArtifact;
    try {
      binding = await this.artifactRepository.resolve<AnyProjectContextBindingArtifact>({
        artifact_id: bindingArtifactId,
        artifact_type: PROJECT_CONTEXT_BINDING_ARTIFACT_TYPE,
      });
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_UNAVAILABLE");
    }

    const verified = validateProjectContextBindingAnyVersion(binding);
    try {
      await verifyProjectContextBindingArtifactAuthority({
        artifact: verified,
        issuerRef: verified.payload.authority_ref,
        artifactRepository: this.artifactRepository,
        verification: this.verification,
      });
    } catch {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_AUTHORITY_INVALID");
    }
    if (
      verified.payload.project_id !== projectId ||
      verified.payload.project_context_ref.artifact_id !== projectContextRef.artifact_id ||
      verified.payload.project_context_ref.artifact_type !== projectContextRef.artifact_type
    ) {
      throw new Error("REJECT_PROJECT_CONTEXT_BINDING_MISMATCH");
    }
    return verified;
  }

  /** Resolves the verified graph head; lookup projection only supplies candidate refs. */
  async resolveCurrent(projectId: string): Promise<AnyProjectContextBindingArtifact> {
    return (await this.resolveCurrentWithRegisteredBindings(projectId)).head;
  }

  /**
   * W-BOOT (APR verifier F1): the verified head AND the ids of every binding the index lists for the
   * project (each one was read and verified on the way, or this throws exactly as resolveCurrent).
   * Lets a caller recognise a row that names a binding outside the project's graph -- evidence of
   * lost binding rows -- instead of trusting whatever head the remaining rows give.
   */
  async resolveCurrentWithRegisteredBindings(projectId: string): Promise<{
    readonly head: AnyProjectContextBindingArtifact;
    readonly registeredBindingIds: ReadonlySet<string>;
  }> {
    let noBindingRegistered = false;
    try {
      if (!this.index.listBindingRefs || !this.index.listSupersessionRefs) {
        throw new Error("REJECT_PROJECT_CONTEXT_BINDING_CURRENT_UNAVAILABLE");
      }
      const [bindingRefs, supersessionRefs] = await Promise.all([
        this.index.listBindingRefs(projectId),
        this.index.listSupersessionRefs(projectId),
      ]);
      noBindingRegistered = bindingRefs.length === 0 && supersessionRefs.length === 0;
      if (bindingRefs.length === 0 && supersessionRefs.length > 0) {
        throw new ProjectContextBindingIndexInconsistentError(
          `${supersessionRefs.length} supersession relation(s) registered for the project but no binding`,
        );
      }
      const bindings = await Promise.all(bindingRefs.map(async (reference) => {
        const binding = validateProjectContextBindingAnyVersion(
          await this.artifactRepository.resolve<AnyProjectContextBindingArtifact>(reference),
        );
        await verifyProjectContextBindingArtifactAuthority({
          artifact: binding,
          issuerRef: binding.payload.authority_ref,
          artifactRepository: this.artifactRepository,
          verification: this.verification,
        });
        return binding;
      }));
      const supersessions = await Promise.all(supersessionRefs.map(async (reference) => {
        const relation = await this.artifactRepository.resolve<AnyProjectContextBindingSupersessionArtifact>({
          artifact_id: reference.artifact_id,
          artifact_type: PROJECT_CONTEXT_BINDING_SUPERSESSION_ARTIFACT_TYPE,
        });
        await verifyProjectContextBindingSupersessionAuthority({
          artifact: relation,
          artifactRepository: this.artifactRepository,
        });
        return relation;
      }));
      return {
        head: resolveCurrentProjectContextBindingHead({ projectId, bindings, supersessions }),
        registeredBindingIds: new Set(bindingRefs.map((reference) => reference.artifact_id)),
      };
    } catch (error) {
      throw new ProjectContextBindingCurrentUnavailableError(noBindingRegistered, error);
    }
  }
}

/**
 * Presentation access requires both project authorization (performed by the injected guard) and
 * proof that the assessment belongs to that project's immutable LU context.
 */
export async function authorizeAssessmentPresentation(args: {
  readonly projectId: string;
  readonly assessment: LocalizationAssessmentArtifact;
  readonly assertProjectAccess: () => Promise<void>;
  readonly bindingProvider: ProjectContextBindingProvider;
}): Promise<AnyProjectContextBindingArtifact> {
  await args.assertProjectAccess();
  return args.bindingProvider.resolve(args.projectId, args.assessment.payload.project_context_ref);
}
