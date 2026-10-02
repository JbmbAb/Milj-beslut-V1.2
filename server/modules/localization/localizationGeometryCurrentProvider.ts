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
import {
  verifyLocalizationGeometrySupersessionArtifact,
  verifyLocalizationGeometrySupersessionIssuerArtifact,
} from "./localizationGeometrySupersessionAuthority";

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
 * M1a-F1 (retryable honesty, OD-R2). Message prefix of the error thrown when a candidate that may
 * matter for currentness hit a PERSISTENT storage integrity fault: it was stored (its id->hash index
 * entry exists) but its CAS object is gone, or its index entry is torn/malformed. That is a technical
 * error -- never "missing" (OD-R2) -- but, unlike a transient read error, repeating the request cannot
 * heal it. localizationGeometryCurrentness.ts classifies it as CURRENTNESS_STORAGE_INTEGRITY_FAULT
 * (503, technical, NOT retryable).
 */
export const LOCALIZATION_GEOMETRY_CANDIDATE_STORAGE_INTEGRITY_FAULT_PREFIX = "LOCALIZATION_GEOMETRY_CANDIDATE_STORAGE_INTEGRITY_FAULT";

/**
 * The persistent storage integrity faults of MimersByteStorageBackend (packages/mps-runtime), matched
 * by their stable `code` (and, for an index entry, its `reason`) on the error or its `cause` chain:
 *  - MIMERS_ARTIFACT_OBJECT_MISSING: the index entry names a CAS object that is not in the CAS;
 *  - MIMERS_ARTIFACT_INDEX_READ_FAILED with reason MALFORMED: the index entry is torn or unparsable.
 * An index entry that could not be READ (reason IO: EBUSY, EPERM from a lock, EIO, ...) is not in
 * this set: its persistence is unknown, so it stays the retryable CANDIDATE_UNRESOLVABLE fault.
 * Matched by value rather than by importing the classes, so this module stays free of runtime imports
 * from the storage package.
 */
function isPersistentStorageIntegrityFault(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const { code, reason, cause } = current as { code?: unknown; reason?: unknown; cause?: unknown };
    if (code === "MIMERS_ARTIFACT_OBJECT_MISSING") return true;
    if (code === "MIMERS_ARTIFACT_INDEX_READ_FAILED" && reason === "MALFORMED") return true;
    current = cause;
  }
  return false;
}

function candidateStorageIntegrityFault(kind: string, artifactId: string | undefined, error: unknown): Error {
  return new Error(
    `${LOCALIZATION_GEOMETRY_CANDIDATE_STORAGE_INTEGRITY_FAULT_PREFIX}: ${kind} ${artifactId ?? "(no ref)"} was stored but ` +
      `cannot be read back (persistent storage integrity fault): ${errorDetail(error)}`,
  );
}

/**
 * OD-R3: the two issuer verdicts that depend on the CONFIGURED verifier key rather than on the
 * issuer's own content -- the issuer's key id is not the configured one (trust root), or its
 * self-attestation does not verify under the configured key (signature). A wrong key produces one of
 * them for every genuine issuer; a forged issuer produces them too. Exact messages, see
 * verifyLocalizationGeometrySupersessionIssuerArtifact.
 */
function isVerifierKeyMismatchVerdict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_TRUST_ROOT" ||
      error.message === "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_SIGNATURE")
  );
}

/** Same prefix as a missing verifier key: classified VERIFIER_CONFIGURATION (503, not retryable). */
const VERIFIER_CONFIGURATION_PREFIX = "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CONFIGURATION";

/**
 * OD-R1 (owner decision 2026-10-02, YES, forward-only, D9(a)). Message prefix of the error thrown
 * when a geometry that MAY BE THE CURRENT POINT according to the verified supersession graph (no
 * verified outgoing edge) was excluded as missing / corrupted / tampered / inconsistent, or is the
 * successor of a verified edge but has no projection row. An older point never becomes current in
 * its place: localizationGeometryCurrentness.ts classifies it as CURRENT_GEOMETRY_UNVERIFIED (409).
 */
export const LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED_PREFIX = "LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED";

/**
 * KNOWN_LIMITATION (owner decision 2026-10-02, M1a-F1 case (b): accepted as an explicit 72h limit; a
 * CAS-anchored head pointer per project is the documented next architecture step, NOT built).
 *
 * Machine-readable marker with exactly this meaning: currentness fails closed for DETECTABLE faults,
 * but it is not proven against a CORRELATED loss of all metadata showing that a newer point existed
 * (e.g. the newest point's projection row AND the supersession-edge row pointing to it both lost: then
 * nothing visible refers to that point and its predecessor resolves as current). No text describing
 * currentness (U51, reports, PDF, UI) may claim more than `meaning_sv` says.
 */
export const LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION = Object.freeze({
  code: "KNOWN_LIMITATION",
  id: "LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS",
  meaning_sv:
    "currentness är fail-closed för detekterbara fel men inte bevisad mot korrelerad förlust av all metadata som visar att en nyare punkt existerat",
  owner_decision: "2026-10-02: accepted as an explicit 72h limit; head pointer documented as the next architecture step, not built",
} as const);

/**
 * Why a geometry candidate whose state WAS determined was excluded. STORAGE_INTEGRITY_FAULT (M1a-F1):
 * stored, but its CAS object is gone or its index entry is torn -- skipped like CORRUPTED_IN_CAS when a
 * verified edge proves the point superseded; otherwise a technical, non-retryable failure (never a
 * refusal, never an older point).
 */
type GeometryExclusionReason =
  | "MISSING_FROM_CAS"
  | "CORRUPTED_IN_CAS"
  | "STORAGE_INTEGRITY_FAULT"
  | "INVALID_CONTENT"
  | "ARTIFACT_ID_MISMATCH"
  | "PROJECT_MISMATCH"
  | "PROPERTY_CONTEXT_MISMATCH";

type GeometryCandidateResult =
  | { readonly kind: "VERIFIED"; readonly geometry: LocalizationGeometryArtifact }
  | { readonly kind: "EXCLUDED"; readonly artifactId: string; readonly reason: GeometryExclusionReason; readonly detail?: string };

/**
 * M1a-F1 (a). Why a supersession edge ROW did not yield a verified edge although its state was
 * determined (a technical failure throws instead). The row still claims "predecessor -> successor".
 */
type EdgeExclusionReason =
  | "EDGE_MISSING_FROM_CAS"
  | "EDGE_CORRUPTED_IN_CAS"
  | "EDGE_INVALID_CONTENT"
  | "EDGE_REJECTED"
  | "ISSUER_MISSING_FROM_CAS"
  | "ISSUER_CORRUPTED_IN_CAS"
  | "ISSUER_KEY_MISMATCH"
  | "ISSUER_REJECTED";

type EdgeCandidateResult =
  | { readonly kind: "VERIFIED"; readonly edge: LocalizationGeometrySupersessionArtifact }
  | {
      readonly kind: "EXCLUDED";
      readonly supersessionArtifactId: string;
      readonly predecessorGeometryArtifactId: string;
      readonly successorGeometryArtifactId: string;
      readonly reason: EdgeExclusionReason;
    };

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
    //
    // M1a-F1: the same holds for a geometry whose CAS object is gone under an intact index entry (or
    // whose index entry is torn): skipped under a verified outgoing edge, like corrupted bytes;
    // otherwise CURRENTNESS_STORAGE_INTEGRITY_FAULT (technical, not retryable).
    //
    // KNOWN_LIMITATION (M1a-F1 (b); see LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION above): the
    // candidate lists come from the two projection indexes only. When the newest point's geometry row
    // AND the edge row pointing to it are BOTH lost, nothing visible here refers to that point, and its
    // predecessor resolves as current. Only a CAS-anchored head pointer per project could detect that.
    const geometryResults = await Promise.all(
      geometryCandidates.map(async (candidate): Promise<GeometryCandidateResult> => {
        const ref = { artifact_id: candidate.geometryArtifactId, artifact_type: GEOMETRY_ARTIFACT_TYPE };
        const excluded = (reason: GeometryExclusionReason, detail?: string): GeometryCandidateResult => ({
          kind: "EXCLUDED",
          artifactId: ref.artifact_id,
          reason,
          ...(detail === undefined ? {} : { detail }),
        });
        let resolved: LocalizationGeometryArtifact;
        try {
          resolved = await this.artifactRepository.resolve<LocalizationGeometryArtifact>(ref);
        } catch (error) {
          if (isMissingArtifactVerdict(error, ref.artifact_id)) return excluded("MISSING_FROM_CAS");
          if (isCorruptedBytesVerdict(error)) return excluded("CORRUPTED_IN_CAS");
          // M1a-F1: a persistent storage fault is a determined state too (stored, not readable back):
          // skippable only under a verified outgoing edge, else a non-retryable technical failure below.
          if (isPersistentStorageIntegrityFault(error)) return excluded("STORAGE_INTEGRITY_FAULT", errorDetail(error));
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
    const storageFaultDetails = new Map<string, string>();
    for (const result of geometryResults) {
      if (result.kind === "VERIFIED") {
        geometries.push(result.geometry);
        continue;
      }
      const key = refKey({ artifact_id: result.artifactId, artifact_type: GEOMETRY_ARTIFACT_TYPE });
      if (!excludedGeometries.has(key)) excludedGeometries.set(key, result.reason);
      if (result.reason === "STORAGE_INTEGRITY_FAULT" && !storageFaultDetails.has(key)) {
        storageFaultDetails.set(key, result.detail ?? "storage integrity fault");
      }
    }
    if (geometries.length === 0) {
      // M1a-F1: no point survived and at least one was lost to a persistent storage fault -- report the
      // storage fault (technical, not retryable), as before this unit, not a NO_VERIFIED refusal.
      const [faulted] = storageFaultDetails.entries();
      if (faulted) {
        throw new Error(
          `${LOCALIZATION_GEOMETRY_CANDIDATE_STORAGE_INTEGRITY_FAULT_PREFIX}: geometry ${faulted[0]} was stored but cannot be read back ` +
            `(persistent storage integrity fault) and no candidate survived CAS re-verification: ${faulted[1]}`,
        );
      }
      throw new Error("REJECT_LOCALIZATION_GEOMETRY_PROJECTION_NOT_FOUND: no candidate survived CAS re-verification");
    }
    const survivingKeys = new Set(geometries.map((g) => refKey(g)));

    const verification =
      supersessionCandidates.length === 0
        ? null
        : typeof this.verification === "function"
          ? this.verification()
          : this.verification;
    // OD-R3: does the configured key verify any issuer of this project at all?
    const issuerEvidence = { verifiedUnderConfiguredKey: 0, keyMismatchVerdicts: 0 };
    const supersessionResults = await Promise.all(
      supersessionCandidates.map(async (candidate): Promise<EdgeCandidateResult> => {
        // OD-R1: EVERY edge candidate is read and verified, also one whose endpoint was excluded --
        // a verified edge is what proves an excluded geometry superseded (skippable) rather than
        // possibly current (fail closed). Edges between surviving geometries alone feed the graph
        // reduction below, exactly as before.
        //
        // Same split as for geometries (DEMO M1a-repair F1/F2): a determined missing / corrupted /
        // REJECT_* verdict excludes the edge (frozen posture); any other failure while reading the
        // edge or its issuer, or while verifying it, fails the whole resolution closed.
        //
        // M1a-F1 (a): an excluded edge is no longer forgotten. Its projection row still claims
        // "predecessor -> successor"; the graph-position check below fails closed when that claimed
        // successor is not visible as a verified geometry (it may be the current point).
        const excluded = (reason: EdgeExclusionReason): EdgeCandidateResult => ({
          kind: "EXCLUDED",
          supersessionArtifactId: candidate.supersessionArtifactId,
          predecessorGeometryArtifactId: candidate.predecessorGeometryArtifactId,
          successorGeometryArtifactId: candidate.successorGeometryArtifactId,
          reason,
        });
        const ref = { artifact_id: candidate.supersessionArtifactId, artifact_type: "localization_geometry_supersession" };
        let artifact: LocalizationGeometrySupersessionArtifact;
        try {
          artifact = await this.artifactRepository.resolve<LocalizationGeometrySupersessionArtifact>(ref);
        } catch (error) {
          if (isMissingArtifactVerdict(error, ref.artifact_id)) return excluded("EDGE_MISSING_FROM_CAS");
          if (isCorruptedBytesVerdict(error)) return excluded("EDGE_CORRUPTED_IN_CAS");
          if (isPersistentStorageIntegrityFault(error)) throw candidateStorageIntegrityFault("supersession", ref.artifact_id, error);
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
        // Structural verdict first, so a malformed edge (e.g. no issuer_ref) is a REJECT_* verdict,
        // not a technical failure while looking up its issuer. Full verification follows below.
        try {
          validateLocalizationGeometrySupersessionArtifact(artifact);
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return excluded("EDGE_INVALID_CONTENT");
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
        const issuerRef = artifact.payload.issuer_ref;
        let issuer: LocalizationGeometrySupersessionIssuerArtifact;
        try {
          issuer = await this.artifactRepository.resolve<LocalizationGeometrySupersessionIssuerArtifact>(issuerRef);
        } catch (error) {
          if (isMissingArtifactVerdict(error, issuerRef.artifact_id)) return excluded("ISSUER_MISSING_FROM_CAS");
          if (isCorruptedBytesVerdict(error)) return excluded("ISSUER_CORRUPTED_IN_CAS");
          if (isPersistentStorageIntegrityFault(error)) {
            throw candidateStorageIntegrityFault("supersession issuer", issuerRef.artifact_id, error);
          }
          throw candidateUnresolvable("supersession issuer", issuerRef.artifact_id, error);
        }
        // OD-R3: the issuer stage on its own, so a verdict that depends on the configured key is told
        // apart from a verdict on the issuer's or the edge's own content. The full verification below
        // repeats it (same deterministic result) together with the edge checks.
        try {
          await verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer, verification: verification! });
        } catch (error) {
          if (isVerifierKeyMismatchVerdict(error)) {
            issuerEvidence.keyMismatchVerdicts += 1;
            return excluded("ISSUER_KEY_MISMATCH");
          }
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return excluded("ISSUER_REJECTED");
          throw candidateUnresolvable("supersession issuer", issuerRef.artifact_id, error);
        }
        issuerEvidence.verifiedUnderConfiguredKey += 1;
        try {
          return { kind: "VERIFIED", edge: await verifyLocalizationGeometrySupersessionArtifact({ artifact, issuer, verification: verification! }) };
        } catch (error) {
          if (isRejectVerdict(error, "REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION")) return excluded("EDGE_REJECTED");
          throw candidateUnresolvable("supersession", ref.artifact_id, error);
        }
      }),
    );
    const supersessions: LocalizationGeometrySupersessionArtifact[] = [];
    const unverifiedEdgeRows: Array<Extract<EdgeCandidateResult, { kind: "EXCLUDED" }>> = [];
    for (const result of supersessionResults) {
      if (result.kind === "VERIFIED") supersessions.push(result.edge);
      else unverifiedEdgeRows.push(result);
    }

    // OD-R3: the configured key verified NO issuer of this project and at least one issuer was
    // rejected on a key-dependent verdict. A wrong key (other material under the same id, another
    // id) looks exactly like that; it cannot be told apart from forged issuers, and either way the
    // graph cannot be decided -- a configuration error (VERIFIER_CONFIGURATION, 503), not an
    // ambiguity. Once the key verifies at least one issuer it is proven right, and a key-dependent
    // rejection of another issuer is a forgery: that edge is excluded as before.
    if (issuerEvidence.verifiedUnderConfiguredKey === 0 && issuerEvidence.keyMismatchVerdicts > 0) {
      throw new Error(
        `${VERIFIER_CONFIGURATION_PREFIX}: the configured verification key (key id ${verification!.keyId}) verifies none of ` +
          `this project's supersession issuers (${issuerEvidence.keyMismatchVerdicts} rejected at the trust root or the issuer ` +
          "signature); currentness is not decided",
      );
    }

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
    // M1a-F1 (2): a point lost to a persistent storage fault is skipped under a verified outgoing edge,
    // exactly like corrupted bytes; as a possibly current point it is a technical, non-retryable
    // failure (CURRENTNESS_STORAGE_INTEGRITY_FAULT), reported before any refusal.
    const storageFaults: string[] = [];
    const unverifiedCurrent: string[] = [];
    for (const node of possiblyCurrent) {
      if (superseded.has(node)) continue;
      const exclusion = excludedGeometries.get(node);
      if (exclusion === undefined && survivingKeys.has(node)) continue;
      if (exclusion === "STORAGE_INTEGRITY_FAULT") {
        storageFaults.push(
          `geometry ${node} has no verified outgoing supersession edge, so it may be the current point, but it was stored ` +
            `and cannot be read back: ${storageFaultDetails.get(node) ?? "storage integrity fault"}`,
        );
        continue;
      }
      unverifiedCurrent.push(
        `geometry ${node} has no verified outgoing supersession edge, so it may be the current point, but it could not be ` +
          `verified (${exclusion ?? "NOT_PROJECTED"})`,
      );
    }
    // M1a-F1 (a): an edge ROW whose edge could not be verified still claims that its predecessor was
    // superseded by its successor. When that successor is not visible -- not a verified geometry, not
    // an excluded (already reported) candidate, not itself proven superseded -- the claim can be
    // neither proven nor refuted: the predecessor may be a superseded point and the successor the
    // current one. Skipping the row (the frozen posture) let the predecessor become current when the
    // successor's projection row was also lost. Fail closed instead; a successor that IS visible keeps
    // the frozen outcome (an ambiguity among the surviving heads).
    for (const row of unverifiedEdgeRows) {
      const successor = refKey({ artifact_id: row.successorGeometryArtifactId, artifact_type: GEOMETRY_ARTIFACT_TYPE });
      if (survivingKeys.has(successor) || excludedGeometries.has(successor) || superseded.has(successor)) continue;
      const predecessor = refKey({ artifact_id: row.predecessorGeometryArtifactId, artifact_type: GEOMETRY_ARTIFACT_TYPE });
      unverifiedCurrent.push(
        `supersession edge ${row.supersessionArtifactId} (projection row ${predecessor} -> ${successor}) could not be verified ` +
          `(${row.reason}) and its successor ${successor} is not a verified projected geometry (NOT_PROJECTED), so ${successor} ` +
          `may be the current point and ${predecessor} may be superseded`,
      );
    }
    if (storageFaults.length > 0) {
      throw new Error(`${LOCALIZATION_GEOMETRY_CANDIDATE_STORAGE_INTEGRITY_FAULT_PREFIX}: ${storageFaults.join("; ")}`);
    }
    if (unverifiedCurrent.length > 0) {
      throw new Error(
        `${LOCALIZATION_GEOMETRY_CURRENT_CANDIDATE_UNVERIFIED_PREFIX}: ${unverifiedCurrent.join("; ")}; an older point is never ` +
          "made current in its place",
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
