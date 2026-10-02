import type { VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import {
  resolveCurrentLocalizationGeometryHead,
  validateLocalizationGeometryArtifact,
  validateLocalizationGeometrySupersessionArtifact,
  type LocalizationGeometryArtifact,
  type LocalizationGeometrySupersessionArtifact,
  type LocalizationGeometrySupersessionIssuerArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import type { LocalizationGeometryProjectionIndex } from "../../repositories/localizationGeometryProjectionRepository";
import type { LocalizationGeometrySupersessionIndex } from "../../repositories/localizationGeometrySupersessionRepository";
import { verifyLocalizationGeometrySupersessionArtifact } from "./localizationGeometrySupersessionAuthority";

/**
 * DEMO M1a-repair (verifier F1/F2), owner decision D9(a). Message prefix of the error thrown when
 * ONE currentness candidate (geometry, supersession edge or its issuer) could not be read or
 * verified for a TECHNICAL reason -- its state is unknown, so the whole resolution fails closed.
 * localizationGeometryCurrentness.ts classifies it as CURRENTNESS_RESOLUTION_ERROR (503, retryable).
 */
export const LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX = "LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE";

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The artifact repository's own "no such artifact" answer for exactly this id (CasArtifactResolver
 *  and InMemoryArtifactRepository both throw this message) -- a determined state: MISSING. */
function isMissingArtifactVerdict(error: unknown, artifactId: string | undefined): boolean {
  return artifactId !== undefined && error instanceof Error && error.message === `Artifact not found: ${artifactId}`;
}

/** CAS re-hashed the stored bytes and they do not match their address -- a determined state: CORRUPTED. */
function isCorruptedBytesVerdict(error: unknown): boolean {
  return error instanceof Error && error.name === "CASIntegrityError";
}

/** A REJECT_* verdict from a validator/verifier run on content that WAS read -- a determined state:
 *  TAMPERED / INVALID / UNTRUSTED. */
function isRejectVerdict(error: unknown, prefix: string): boolean {
  return error instanceof Error && error.message.startsWith(prefix);
}

function candidateUnresolvable(kind: string, artifactId: string | undefined, error: unknown): Error {
  return new Error(
    `${LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE_PREFIX}: ${kind} ${artifactId ?? "(no ref)"} could not be read or verified: ${errorDetail(error)}`,
  );
}

/**
 * OD-R1 (owner decision 2026-10-02, YES, forward-only, D9(a)). Message prefix of the error thrown
 * when a geometry that MAY BE THE CURRENT POINT according to the verified supersession graph (no
 * verified outgoing edge) was excluded as missing / corrupted / tampered / inconsistent, or is the
 * successor of a verified edge but has no projection row. An older point never becomes current in
 * its place: localizationGeometryCurrentness.ts classifies it as CURRENT_GEOMETRY_UNVERIFIED (409).
 */
export const LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED_PREFIX = "LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED";

/** Why a geometry candidate whose state WAS determined was excluded. */
type GeometryExclusionReason =
  | "MISSING_FROM_CAS"
  | "CORRUPTED_IN_CAS"
  | "INVALID_CONTENT"
  | "ARTIFACT_ID_MISMATCH"
  | "PROJECT_MISMATCH"
  | "PROPERTY_CONTEXT_MISMATCH";

type GeometryCandidateResult =
  | { readonly kind: "VERIFIED"; readonly geometry: LocalizationGeometryArtifact }
  | { readonly kind: "EXCLUDED"; readonly artifactId: string; readonly reason: GeometryExclusionReason };

const GEOMETRY_ARTIFACT_TYPE = "localization_geometry";

const refKey = (r: { readonly artifact_id: string; readonly artifact_type: string }) => `${r.artifact_type}:${r.artifact_id}`;

/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B.
 *
 * Resolves the CURRENT LocalizationGeometry for a project via the verified supersession graph --
 * `createdAt` and artifact-id lexical order play no role. Same shape as
 * ProjectContextBindingProvider.resolveCurrent: the two Postgres indexes only supply CANDIDATE
 * refs (non-authoritative, rebuildable); every candidate (geometry AND supersession) is
 * independently resolved from CAS and re-verified here before being trusted as a graph node/edge.
 * Geometry artifacts get structural + project_id verification (unsigned user content, per the
 * frozen contract); supersession artifacts get full issuer-trust-chain + signature verification
 * (the authority actually lives on the transition, not the content).
 */
export class LocalizationGeometryCurrentProvider {
  /**
   * `verification` is a thunk, not an instance: a project with zero or one geometry (no
   * supersession edges to verify at all) must resolve without ever requiring
   * LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PUBLIC_KEY_PEM to be configured -- e.g. a project's
   * very first GET-current, or a test that never exercises a transition. Only called lazily, and
   * only when there is at least one supersession candidate to verify.
   */
  constructor(
    private readonly artifactRepository: ArtifactRepositoryPort,
    private readonly geometryIndex: LocalizationGeometryProjectionIndex,
    private readonly supersessionIndex: LocalizationGeometrySupersessionIndex,
    private readonly verification: VerificationKeyProvider | (() => VerificationKeyProvider),
  ) {}

  async resolveCurrent(projectId: string): Promise<LocalizationGeometryArtifact> {
    const [geometryCandidates, supersessionCandidates] = await Promise.all([
      this.geometryIndex.listForProject(projectId),
      this.supersessionIndex.listForProject(projectId),
    ]);
    if (geometryCandidates.length === 0) {
      throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no localization geometry projection for project");
    }

    const sameRef = (left: ArtifactReference, right: ArtifactReference) =>
      left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;

    // An individually corrupted/tampered/missing candidate is EXCLUDED, not fatal to the whole
    // resolution -- same resilience posture as every other current-selection path in this
    // codebase (Assessment: reject-and-continue). Only a genuine multi-node ambiguity (fork,
    // cycle) among the SURVIVING, verified set fails the whole resolution closed.
    //
    // DEMO M1a-repair (F1/F2, D9(a)): that frozen posture covers candidates whose state WAS
    // determined -- missing (the repository's not-found verdict), corrupted (CAS integrity
    // verdict), tampered/invalid (a REJECT_* verdict on content that was read), or bound to another
    // project/property context. It does not cover a read or verification step that FAILED: then the
    // candidate's state is unknown, it may be the real head, and excluding it could make a superseded
    // point current. Such a technical failure therefore fails the whole resolution closed
    // (LOCALIZATION_GEOMETRY_CANDIDATE_UNRESOLVABLE -> CURRENTNESS_RESOLUTION_ERROR, 503).
    //
    // OD-R1 (forward-only, D9(a)): exclusion is no longer the last word. An excluded geometry may
    // only be skipped when a VERIFIED supersession edge proves it superseded (see the graph-position
    // check below); otherwise it may be the current point and the whole resolution fails closed.
    const geometryResults = await Promise.all(
      geometryCandidates.map(async (candidate): Promise<GeometryCandidateResult> => {
        const ref = { artifact_id: candidate.geometryArtifactId, artifact_type: GEOMETRY_ARTIFACT_TYPE };
        const excluded = (reason: GeometryExclusionReason): GeometryCandidateResult => ({ kind: "EXCLUDED", artifactId: ref.artifact_id, reason });
        let resolved: LocalizationGeometryArtifact;
        try {
          resolved = await this.artifactRepository.resolve<LocalizationGeometryArtifact>(ref);
        } catch (error) {
          if (isMissingArtifactVerdict(error, ref.artifact_id)) return excluded("MISSING_FROM_CAS");
          if (isCorruptedBytesVerdict(error)) return excluded("CORRUPTED_IN_CAS");
          throw candidateUnresolvable("geometry", ref.artifact_id, error);
        }
        let geometry: LocalizationGeometryArtifact;
        try {
          geometry = validateLocalizationGeometryArtifact(resolved);
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY")) return excluded("INVALID_CONTENT");
          throw candidateUnresolvable("geometry", ref.artifact_id, error);
        }
        // OD-R1: content stored under this id must BE this id (an index pointing at another,
        // self-consistent artifact is an inconsistency, never a substitute point).
        if (geometry.artifact_id !== ref.artifact_id) return excluded("ARTIFACT_ID_MISMATCH");
        if (geometry.payload.project_id !== projectId) return excluded("PROJECT_MISMATCH");
        if (
          !sameRef(geometry.payload.property_context_ref, {
            artifact_id: candidate.propertyContextRefId,
            artifact_type: candidate.propertyContextRefType,
          })
        ) {
          return excluded("PROPERTY_CONTEXT_MISMATCH");
        }
        return { kind: "VERIFIED", geometry };
      }),
    );
    const geometries: LocalizationGeometryArtifact[] = [];
    const excludedGeometries = new Map<string, GeometryExclusionReason>();
    for (const result of geometryResults) {
      if (result.kind === "VERIFIED") {
        geometries.push(result.geometry);
        continue;
      }
      const key = refKey({ artifact_id: result.artifactId, artifact_type: GEOMETRY_ARTIFACT_TYPE });
      if (!excludedGeometries.has(key)) excludedGeometries.set(key, result.reason);
    }
    if (geometries.length === 0) {
      throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no candidate survived CAS re-verification");
    }
    const survivingKeys = new Set(geometries.map((g) => refKey(g)));

    const verification =
      supersessionCandidates.length === 0
        ? null
        : typeof this.verification === "function"
          ? this.verification()
          : this.verification;
    const supersessionResults = await Promise.all(
      supersessionCandidates.map(async (candidate) => {
        // OD-R1: EVERY edge candidate is read and verified, also one whose endpoint was excluded --
        // a verified edge is what proves an excluded geometry superseded (skippable) rather than
        // possibly current (fail closed). Edges between surviving geometries alone feed the graph
        // reduction below, exactly as before.
        //
        // Same split as for geometries (DEMO M1a-repair F1/F2): a determined missing / corrupted /
        // REJECT_* verdict excludes the edge (frozen posture); any other failure while reading the
        // edge or its issuer, or while verifying it, fails the whole resolution closed.
        const ref = { artifact_id: candidate.supersessionArtifactId, artifact_type: "localization_geometry_supersession" };
        let artifact: LocalizationGeometrySupersessionArtifact;
        try {
          artifact = await this.artifactRepository.resolve<LocalizationGeometrySupersessionArtifact>(ref);
        } catch (error) {
          if (isMissingArtifactVerdict(error, ref.artifact_id) || isCorruptedBytesVerdict(error)) return null;
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
        // Structural verdict first, so a malformed edge (e.g. no issuer_ref) is a REJECT_* verdict,
        // not a technical failure while looking up its issuer. Full verification follows below.
        try {
          validateLocalizationGeometrySupersessionArtifact(artifact);
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return null;
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
        const issuerRef = artifact.payload.issuer_ref;
        let issuer: LocalizationGeometrySupersessionIssuerArtifact;
        try {
          issuer = await this.artifactRepository.resolve<LocalizationGeometrySupersessionIssuerArtifact>(issuerRef);
        } catch (error) {
          if (isMissingArtifactVerdict(error, issuerRef.artifact_id) || isCorruptedBytesVerdict(error)) return null;
          throw candidateUnresolvable("supersession issuer", issuerRef.artifact_id, error);
        }
        try {
          return await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification: verification! });
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return null;
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
      }),
    );
    const supersessions = supersessionResults.filter((s): s is LocalizationGeometrySupersessionArtifact => s !== null);

    // OD-R1 graph-position check. A geometry with a verified outgoing edge is superseded and can
    // never be current: if it was excluded, skipping it is the frozen rule and changes nothing. Any
    // other node -- a geometry candidate without a verified outgoing edge, or the successor of a
    // verified edge -- may be the current point; if it is not a verified, consistent geometry the
    // whole resolution fails closed instead of letting an older point win.
    for (const edge of supersessions) {
      if (edge.payload.project_id !== projectId) throw new Error("REJECT_LOCALIZATION_GEOMETRY_HEAD: supersession project");
    }
    const superseded = new Set(supersessions.map((edge) => refKey(edge.payload.predecessor_geometry_ref)));
    const possiblyCurrent = new Set<string>([
      ...survivingKeys,
      ...excludedGeometries.keys(),
      ...supersessions.map((edge) => refKey(edge.payload.successor_geometry_ref)),
    ]);
    for (const node of possiblyCurrent) {
      if (superseded.has(node)) continue;
      const exclusion = excludedGeometries.get(node);
      if (exclusion === undefined && survivingKeys.has(node)) continue;
      throw new Error(
        `${LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED_PREFIX}: geometry ${node} has no verified outgoing supersession ` +
          `edge, so it may be the current point, but it could not be verified (${exclusion ?? "NOT_PROJECTED"}); an older point ` +
          "is never made current in its place",
      );
    }

    // Unchanged reduction over the surviving, verified subgraph (fork, cycle, multiple heads).
    const head = resolveCurrentLocalizationGeometryHead({
      projectId,
      geometries,
      supersessions: supersessions.filter(
        (edge) => survivingKeys.has(refKey(edge.payload.predecessor_geometry_ref)) && survivingKeys.has(refKey(edge.payload.successor_geometry_ref)),
      ),
    });
    // OD-R1 invariant: never return a geometry that a verified edge says was superseded (reachable
    // only when the edge's successor was excluded inside a cycle, e.g. A -> B -> A with B missing).
    if (superseded.has(refKey(head))) {
      throw new Error(
        `INVALID_SUPERSESSION_GRAPH: geometry ${refKey(head)} is superseded by a verified edge whose successor is not a verified geometry`,
      );
    }
    return head;
  }
}
