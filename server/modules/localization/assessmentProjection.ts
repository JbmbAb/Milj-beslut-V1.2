/**
 * P3-LU-ASSESSMENT-CURRENT-PROJECTION-01.
 *
 * A durable, non-authoritative locator: "which already-persisted LocalizationAssessmentArtifact
 * is current for this project's current ProjectContextBinding." CAS remains the sole content
 * authority -- registerAssessmentProjection only ever records a pointer to an artifact that has
 * already been persisted (by GovernedAssessmentPersistence, elsewhere); resolveCurrentAssessmentProjection
 * never trusts a projection row's own claims and re-resolves + re-verifies every candidate against
 * CAS before selecting it.
 *
 * Projection registration time is operational bookkeeping, never current-state authority.
 * Selection is: eligibility (bound to the current head) -> CAS re-verification (exists, correct
 * type, untampered, project_context_ref matches the row) -> exactly one verified survivor. More
 * than one semantically distinct verified survivor is an unresolved authority conflict and fails
 * closed until an explicit signed assessment-current/supersession relation exists.
 *
 * W-APR (owner decisions OD-R1/OD-R2, 2026-10-02, forward-only): an eligible candidate that cannot be
 * read or verified is never skipped -- it may be the current assessment, so the whole resolution
 * fails closed with AssessmentProjectionCandidateUnverifiableError. See resolveCurrentAssessmentProjection.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import {
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
  type LocalizationAssessmentArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import {
  PrismaProjectAssessmentProjectionIndex,
  type ProjectAssessmentProjectionIndex,
} from "../../repositories/projectAssessmentProjectionRepository.js";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime.js";
import { classifyReadFault, readExistingOrProvenAbsent } from "./readFaultClassification.js";

function sameHash(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

/**
 * Called from the real write path (generate-localization-report.usecase.ts) right after a
 * successful kernel run, never from the generic kernel client -- this keeps product-specific
 * persistence out of the generic governed execution chain. Idempotent: an identical re-run
 * produces the identical (content-addressed) assessment artifact_id, so re-registering it is a
 * harmless no-op (`ON CONFLICT DO NOTHING`), not a duplicate row.
 */
export async function registerAssessmentProjection(args: {
  readonly projectId: string;
  readonly assessment: LocalizationAssessmentArtifact;
  readonly contextBindingRef: ArtifactReference;
  readonly releaseRef: ArtifactReference;
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. The current LocalizationGeometryArtifact this assessment
   * was produced for. Optional so a caller with no explicit geometry yet (pre-Phase-B / legacy
   * path) still registers -- but see resolveCurrentAssessmentProjection: a row with this unset can
   * never satisfy a caller that requires current-geometry eligibility.
   */
  readonly localizationGeometryArtifactId?: string;
  readonly index?: ProjectAssessmentProjectionIndex;
}): Promise<void> {
  const index = args.index ?? new PrismaProjectAssessmentProjectionIndex();
  await index.register({
    projectId: args.projectId,
    assessmentArtifactId: args.assessment.artifact_id,
    assessmentArtifactType: args.assessment.artifact_type,
    projectContextRef: args.assessment.payload.project_context_ref,
    bindingArtifactId: args.contextBindingRef.artifact_id,
    releaseArtifactId: args.releaseRef.artifact_id,
    localizationGeometryArtifactId: args.localizationGeometryArtifactId ?? null,
  });
}

export interface CurrentAssessmentProjection {
  readonly assessmentArtifactId: string;
}

/**
 * KNOWN_LIMITATION (W-BOOT 2026-10-02, on the APR verifier's F1/F9; accepted by the owner 2026-10-03,
 * decision (4) p.6, as an explicit PRODUCT LIMITATION -- documented, NOT approved behaviour).
 * Machine-readable marker, analogous to LOCALIZATION_GEOMETRY_CURRENTNESS_KNOWN_LIMITATION: the
 * current-assessment selection fails closed for DETECTABLE faults, but it is not proven against a
 * CORRELATED loss or corruption of all metadata showing that a newer assessment or binding existed
 * (the assessment's projection row with its binding and point columns, and the binding index's
 * binding and supersession rows). W-CATCH2 (BOOT verifier finding 2): the row's TYPE column is no
 * longer part of it -- its domain is closed, so another value is detected and fails closed. No text
 * describing current-assessment selection (U51, reports, PDF, UI) may claim more than `meaning_sv`
 * says. The structural fix (a signed current/supersession relation or a CAS-anchored head pointer) is
 * not built.
 */
export const ASSESSMENT_PROJECTION_CURRENTNESS_KNOWN_LIMITATION = Object.freeze({
  code: "KNOWN_LIMITATION",
  id: "ASSESSMENT_PROJECTION_CURRENTNESS_CORRELATED_METADATA_LOSS",
  meaning_sv:
    "valet av aktuell bedömning är fail-closed för detekterbara fel men inte bevisat mot korrelerad förlust eller förvanskning av all metadata som visar att en nyare bedömning eller bindning existerat (bedömningens projektionsrad med dess bindnings- och punktkolumner samt bindningsindexets bindnings- och ersättningsrader)",
  owner_decision:
    "ACCEPTED 2026-10-03 (owner decision (4) p.6) as an explicit PRODUCT LIMITATION, documented and NOT approved behaviour; analogous to LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS; the structural fix (a signed current relation or a CAS-anchored head pointer) is not built",
} as const);

export const ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE = "ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE" as const;

/**
 * W-APR: why a candidate that may be the current assessment could not be read or verified.
 *  - READ_ERROR: the CAS read failed in a way whose persistence is unknown (EIO, EBUSY, a lock, an
 *    index entry that could not be READ) -- retryable;
 *  - STORAGE_INTEGRITY_FAULT: a lasting storage fault -- the object is gone behind its index entry,
 *    the index entry is torn, or the bytes do not match their address (storageFaultClassification);
 *  - MISSING_FROM_CAS: the CAS has no entry at all for an assessment the projection registered (rows
 *    are written only after the assessment was persisted, so this is lost storage, not absence);
 *  - TAMPERED: the content does not hash to its own content_hash / artifact_id;
 *  - ARTIFACT_ID_MISMATCH: the CAS returned a different artifact under the requested id;
 *  - PROJECTION_ROW_INCONSISTENT: the row's context contradicts a verified artifact that IS bound to
 *    the current context (the row is wrong; the artifact may well be the current assessment); or
 *    (W-BOOT, APR verifier F1) the row names a binding outside the project's verified binding graph
 *    (binding rows are lost; the remaining head may be an older binding).
 * Every reason except READ_ERROR is lasting: a retry cannot heal it.
 */
export type AssessmentCandidateFaultReason =
  | "READ_ERROR"
  | "STORAGE_INTEGRITY_FAULT"
  | "MISSING_FROM_CAS"
  | "TAMPERED"
  | "ARTIFACT_ID_MISMATCH"
  | "PROJECTION_ROW_INCONSISTENT";

export interface AssessmentCandidateFault {
  readonly assessmentArtifactId: string;
  readonly reason: AssessmentCandidateFaultReason;
  readonly retryable: boolean;
}

/**
 * W-APR (OD-R1/OD-R2): at least one candidate that may be the current assessment could not be read
 * or verified, so the current assessment cannot be determined -- and no other candidate is selected
 * in its place. Deliberately NOT a REJECT_* error: callers map REJECT_* to "no current assessment"
 * (404), and this is a technical/integrity fault, never an absence. `retryable` is true only when
 * every fault is a READ_ERROR. `faults` is sorted by id, so the error is independent of row order.
 * The message (ids, reasons) is server-side detail and must not be sent to a client.
 */
export class AssessmentProjectionCandidateUnverifiableError extends Error {
  readonly code = ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE;
  readonly retryable: boolean;
  readonly faults: readonly AssessmentCandidateFault[];

  constructor(faults: readonly AssessmentCandidateFault[]) {
    const sorted = [...faults].sort((a, b) =>
      a.assessmentArtifactId < b.assessmentArtifactId ? -1 : a.assessmentArtifactId > b.assessmentArtifactId ? 1 : 0,
    );
    super(
      `${ASSESSMENT_PROJECTION_CANDIDATE_UNVERIFIABLE}: ${sorted.length} assessment candidate(s) bound to the current ` +
        `binding/geometry could not be read or verified (${sorted.map((f) => `${f.assessmentArtifactId}: ${f.reason}`).join(", ")}); ` +
        "the current assessment cannot be determined and no other candidate is selected in its place",
    );
    this.name = "AssessmentProjectionCandidateUnverifiableError";
    this.faults = sorted;
    this.retryable = sorted.every((f) => f.retryable);
  }
}

export const ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE = "ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE" as const;

/**
 * W-APR add-on 2 (U20CDF2 verifier H1): why the current ProjectContextBinding could not be resolved,
 * when the project DOES have bindings (no binding at all stays REJECT_..._NOT_FOUND, genuine absence):
 *  - READ_ERROR: the binding index, a binding, its issuer or a relation could not be read for a reason
 *    of unknown persistence (EIO, a lock, the index database down) -- retryable;
 *  - STORAGE_INTEGRITY_FAULT / MISSING_FROM_CAS: a lasting storage fault, or an artifact the index
 *    lists is not in the CAS -- not retryable;
 *  - REFUSED: a binding, issuer or supersession failed verification, or the binding graph has no
 *    single head (`refusalCode` is the REJECT_* token) -- not retryable.
 *  - BINDING_INDEX_INCONSISTENT (W-BOOT, APR verifier F2): binding rows are lost -- the project has
 *    projection rows (each names a binding) or supersession rows, but no binding is registered --
 *    not retryable; never the REJECT_..._NOT_FOUND absence.
 */
export type CurrentBindingFaultReason = "READ_ERROR" | "STORAGE_INTEGRITY_FAULT" | "MISSING_FROM_CAS" | "REFUSED" | "BINDING_INDEX_INCONSISTENT";

/**
 * W-APR add-on 2: the current binding could not be resolved, so no assessment can be selected. Not a
 * REJECT_* error (callers map REJECT_* absence to 404). The message is server-side detail.
 */
export class AssessmentProjectionBindingUnresolvableError extends Error {
  readonly code = ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE;
  readonly reason: CurrentBindingFaultReason;
  readonly retryable: boolean;
  readonly refusalCode: string | null;

  constructor(reason: CurrentBindingFaultReason, refusalCode: string | null, cause: unknown) {
    super(
      `${ASSESSMENT_PROJECTION_BINDING_UNRESOLVABLE}: the current ProjectContextBinding could not be resolved ` +
        `(${reason}${refusalCode ? `: ${refusalCode}` : ""}); no assessment is selected`,
      { cause },
    );
    this.name = "AssessmentProjectionBindingUnresolvableError";
    this.reason = reason;
    this.retryable = reason === "READ_ERROR";
    this.refusalCode = refusalCode;
  }
}

/**
 * W-APR add-on 2: the nature of a resolveCurrent failure. W-CATCH2: the shared rule
 * (readFaultClassification.ts classifyReadFault) -- no second copy here; structural binding-index damage
 * behind a head refusal is BINDING_INDEX_INCONSISTENT (W-BOOT verifier finding 3).
 */
function currentBindingFault(error: unknown): AssessmentProjectionBindingUnresolvableError {
  const fault = classifyReadFault(error);
  return new AssessmentProjectionBindingUnresolvableError(fault.faultClass, fault.refusalCode, error);
}

/**
 * Classifies a failed CAS read of a candidate (OD-R2: only a read of unknown persistence is retryable).
 * W-CATCH3 (CATCH2 verifier finding 6): by the shared classification (readFaultClassification.ts), no
 * second copy -- "Artifact not found" of any id (the row says the candidate exists) is MISSING_FROM_CAS,
 * and every other lasting class (a storage fault, a WORM violation, an index inconsistency, a refusal
 * met while reading) is STORAGE_INTEGRITY_FAULT in this candidate vocabulary; `retryable` is the shared
 * class's (READ_ERROR only).
 */
function candidateReadFault(error: unknown, assessmentArtifactId: string): AssessmentCandidateFault {
  const fault = classifyReadFault(error, "read");
  const reason: AssessmentCandidateFaultReason =
    fault.faultClass === "READ_ERROR" || fault.faultClass === "MISSING_FROM_CAS" ? fault.faultClass : "STORAGE_INTEGRITY_FAULT";
  return { assessmentArtifactId, reason, retryable: fault.retryable };
}

/** The candidate read is exactly the requested assessment, and its content hashes to its own identity. */
function candidateIdentityFault(value: unknown, assessmentArtifactId: string): AssessmentCandidateFault | null {
  if (typeof value !== "object" || value === null) {
    return { assessmentArtifactId, reason: "TAMPERED", retryable: false };
  }
  const assessment = value as LocalizationAssessmentArtifact;
  if (assessment.artifact_id !== assessmentArtifactId) {
    return { assessmentArtifactId, reason: "ARTIFACT_ID_MISMATCH", retryable: false };
  }
  let untampered = false;
  try {
    const recomputed = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
    untampered =
      typeof assessment.content_hash === "object" &&
      assessment.content_hash !== null &&
      sameHash(assessment.content_hash, recomputed) &&
      assessment.artifact_id === `assessment-${recomputed.value}`;
  } catch {
    // CATCH-REVIEWED: NOT_A_READ: recomputing the canonical hash of content already read; any failure is TAMPERED (fail closed).
    untampered = false;
  }
  return untampered ? null : { assessmentArtifactId, reason: "TAMPERED", retryable: false };
}

/**
 * Selection order (frozen, LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B): load
 * candidates -> resolveCurrent(projectId) via the verified ProjectContextBinding graph -> retain
 * only rows bound to that exact current head (and current geometry, if supplied) -> re-resolve and
 * re-verify EVERY remaining candidate against CAS (never short-circuit) -> require exactly one
 * verified survivor. More than one verified survivor fails closed
 * (REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT); registration order, row order, and createdAt
 * are never a tiebreaker.
 *
 * W-APR (OD-R1/OD-R2, forward-only). Because nothing orders the candidates, EVERY eligible candidate
 * (row bound to this project, the current binding and -- when supplied -- the current point) may be
 * the current assessment. A candidate is skipped ONLY when it provably cannot be current:
 *  (1) its row is not eligible (another project, binding or point) -- it is never read, so a lost or
 *      broken historical assessment never blocks the current one. W-CATCH2 (BOOT verifier finding 2):
 *      a row whose TYPE value is not LOCALIZATION_ASSESSMENT is not "ineligible" but damaged (the
 *      column has a closed domain) and fails the resolution closed (PROJECTION_ROW_INCONSISTENT);
 *  (2) its own CAS-verified content is bound to another point than the current one, or to another
 *      project context than the current binding's.
 * Any other eligible candidate that cannot be read or verified (read error, lost object, missing
 * index entry, torn entry, corrupt bytes, tampered content, another artifact under its id, a row that
 * contradicts a verified current-context artifact) fails the WHOLE resolution closed with
 * AssessmentProjectionCandidateUnverifiableError -- never a skip that lets another (older) candidate
 * be selected, and never the REJECT_* "no assessment" absence. Every eligible candidate is examined
 * before deciding; the fault is reported before an ambiguity refusal or a contract-version refusal.
 *
 * KNOWN LIMITATION (analogous to M1a's LOCALIZATION_GEOMETRY_CURRENTNESS_CORRELATED_METADATA_LOSS;
 * machine-readable: ASSESSMENT_PROJECTION_CURRENTNESS_KNOWN_LIMITATION below): candidates come only
 * from the projection rows, and the binding graph only from the binding index. A newer assessment
 * whose row is lost (or whose row's binding or point column is corrupted so it looks ineligible) is
 * invisible here, whether or not its CAS object survives; an older verified candidate is then
 * selected. (A corrupted TYPE column is detected -- W-CATCH2, see above.) The same holds when a newer binding's index row AND its supersession row are lost
 * together with every projection row that names it -- W-BOOT (APR F1) detects the case where such a
 * row survives (PROJECTION_ROW_INCONSISTENT), not the fully correlated loss. Not detected, not approved.
 */
export async function resolveCurrentAssessmentProjection(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly currentBindingProvider: ProjectContextBindingProvider;
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. When provided, eligibility ALSO requires the candidate's
   * `localizationGeometryArtifactId` to equal this -- current-assessment resolution then means
   * "current binding AND current localization point", not binding alone. A moved-away-from point's
   * assessment (still bound to the current binding) is excluded rather than wrongly selected as
   * current. Omitted by callers for a project with no localization geometry yet (legacy/pre-Phase-B):
   * behavior is then unchanged (binding-only eligibility), so existing projects are not broken by
   * this addition.
   */
  readonly currentLocalizationGeometryArtifactId?: string;
  readonly index?: ProjectAssessmentProjectionIndex;
}): Promise<CurrentAssessmentProjection> {
  const index = args.index ?? new PrismaProjectAssessmentProjectionIndex();
  const candidates = await index.listForProject(args.projectId);
  if (candidates.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no assessment projection for project");
  }

  let currentBinding: { readonly artifact_id: string; readonly payload?: { readonly project_context_ref?: ArtifactReference } };
  // W-BOOT (APR verifier F1): every binding the index lists for the project, or null for a provider
  // stand-in that can only give the head (then rows are not checked against the graph).
  let registeredBindingIds: ReadonlySet<string> | null = null;
  try {
    const provider = args.currentBindingProvider as Partial<Pick<ProjectContextBindingProvider, "resolveCurrentWithRegisteredBindings">> &
      Pick<ProjectContextBindingProvider, "resolveCurrent">;
    if (typeof provider.resolveCurrentWithRegisteredBindings === "function") {
      const graph = await provider.resolveCurrentWithRegisteredBindings(args.projectId);
      currentBinding = graph.head;
      registeredBindingIds = graph.registeredBindingIds;
    } else {
      currentBinding = await provider.resolveCurrent(args.projectId);
    }
  } catch (error) {
    // W-APR add-on 2 (OD-R2): a binding that cannot be read, or that is refused, is a typed fault --
    // never "no current assessment".
    // W-BOOT (APR verifier F2): nor is "no binding registered" absence HERE: this project has
    // projection rows (candidates.length > 0 above), and a row is only ever written under a
    // registered binding, so the binding rows are lost -- a lasting integrity fault, not a 404.
    if ((error as { noBindingRegistered?: unknown } | null)?.noBindingRegistered === true) {
      throw new AssessmentProjectionBindingUnresolvableError("BINDING_INDEX_INCONSISTENT", null, error);
    }
    throw currentBindingFault(error);
  }
  // The verified current binding's own context (W-APR criterion (2)); undefined only for a provider
  // stand-in that does not return the binding artifact, in which case nothing is proven by context.
  const currentContextRef = currentBinding.payload?.project_context_ref;

  // W-BOOT (APR verifier F1): a row is only ever written under a registered binding of its project,
  // so a row of this project naming a binding OUTSIDE the verified graph proves lost binding rows
  // (e.g. the newer binding's row and its supersession row): the remaining head may be an OLDER
  // binding, and its assessment must not be presented. Every such row is PROJECTION_ROW_INCONSISTENT
  // and fails the resolution closed, before anything is read. Checked on every row of the project.
  if (registeredBindingIds !== null) {
    const graph = registeredBindingIds;
    const outside = candidates.filter((c) => c.projectId === args.projectId && !graph.has(c.bindingArtifactId));
    if (outside.length > 0) {
      throw new AssessmentProjectionCandidateUnverifiableError(
        outside.map((c) => ({ assessmentArtifactId: c.assessmentArtifactId, reason: "PROJECTION_ROW_INCONSISTENT" as const, retryable: false })),
      );
    }
  }

  // W-CATCH2 (BOOT verifier finding 2; owner decision (4) p.6, detectable loss fails closed): every write
  // path writes exactly LOCALIZATION_ASSESSMENT into a row's type column (registerAssessmentProjection
  // takes a LocalizationAssessmentArtifact; reconcileAssessmentProjection refuses WRONG_TYPE), so any
  // other value is DETECTABLE damage of the row -- and a damaged row's binding and point columns are no
  // evidence either. Every such row of the project is PROJECTION_ROW_INCONSISTENT and fails the
  // resolution closed before anything is read: never 404 "no assessment", never another candidate in
  // its place. (Before, such a row was skipped unread as "not an LU assessment row".)
  const damagedType = candidates.filter((c) => c.projectId === args.projectId && c.assessmentArtifactType !== "LOCALIZATION_ASSESSMENT");
  if (damagedType.length > 0) {
    throw new AssessmentProjectionCandidateUnverifiableError(
      damagedType.map((c) => ({ assessmentArtifactId: c.assessmentArtifactId, reason: "PROJECTION_ROW_INCONSISTENT" as const, retryable: false })),
    );
  }

  const eligible = candidates.filter(
    (c) =>
      c.projectId === args.projectId &&
      c.bindingArtifactId === currentBinding.artifact_id &&
      (args.currentLocalizationGeometryArtifactId === undefined ||
        c.localizationGeometryArtifactId === args.currentLocalizationGeometryArtifactId),
  );
  if (eligible.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT: no candidate bound to the current ProjectContextBinding and localization geometry");
  }

  // Verify EVERY eligible candidate against CAS first (never short-circuit on the first pass).
  // The ambiguity check applies only to genuine verified survivors, so a tampered/orphaned row
  // cannot manufacture a false conflict. createdAt remains operational projection metadata only.
  // W-APR: nor can it be skipped -- a candidate that may be current and cannot be verified is a fault.
  const verified: LocalizationAssessmentArtifact[] = [];
  const faults: AssessmentCandidateFault[] = [];
  let contractVersionRefusal: unknown = null;
  for (const candidate of eligible) {
    // (Criterion (1) by type is gone: a row of another type is damage and has failed closed above.)
    let read: unknown;
    try {
      read = await args.artifactRepository.resolve<LocalizationAssessmentArtifact>({
        artifact_id: candidate.assessmentArtifactId,
        artifact_type: "LOCALIZATION_ASSESSMENT",
      });
    } catch (error) {
      // OD-R2: a read failure is a technical/integrity fault, never "this candidate does not exist".
      faults.push(candidateReadFault(error, candidate.assessmentArtifactId));
      continue;
    }

    const identityFault = candidateIdentityFault(read, candidate.assessmentArtifactId);
    if (identityFault) {
      faults.push(identityFault); // tampered / another artifact under this id: lasting, never skipped
      continue;
    }
    const assessment = read as LocalizationAssessmentArtifact;

    // H2/H12: explicit version dispatch -- absent version = legacy V1 shape (no extra rules
    // beyond the hash check above); V2 marker = V2 structural rules (canonicalizer_id, canonical
    // evidence_refs); anything else fails closed. Not swallowed into "reject this candidate" --
    // an unknown contract version is a hard error, not a benign missing-CAS-object situation.
    // W-APR: still thrown (unchanged class), but after every candidate was examined, so a fault on
    // another candidate is never hidden behind it and the answer does not depend on row order.
    try {
      validateLocalizationAssessmentContractVersion(assessment.payload);
    } catch (error) {
      // CATCH-REVIEWED: DEFERRED_RETHROW: the contract-version refusal is thrown after every candidate was examined (fail closed, order-independent).
      contractVersionRefusal ??= error;
      continue;
    }

    // Criterion (2): the CAS-verified content itself proves this candidate is not current.
    if (
      args.currentLocalizationGeometryArtifactId !== undefined &&
      assessment.payload.localization_geometry_ref?.artifact_id !== args.currentLocalizationGeometryArtifactId
    ) {
      // The row passed the earlier filter, but the CAS artifact's own claim disagrees (or is
      // absent) -- it is bound to another point, so it is not current; never trust the row's column.
      continue;
    }
    if (currentContextRef !== undefined && !sameRef(assessment.payload.project_context_ref, currentContextRef)) {
      // Computed for another project context than the current binding's: never current, whatever
      // its row claims.
      continue;
    }

    if (
      !sameRef(assessment.payload.project_context_ref, {
        artifact_id: candidate.projectContextRefId,
        artifact_type: candidate.projectContextRefType,
      })
    ) {
      // The projection row claims a context this artifact does not carry, and the artifact is not
      // proven non-current above: the row is wrong, the artifact may be the current assessment.
      faults.push({ assessmentArtifactId: candidate.assessmentArtifactId, reason: "PROJECTION_ROW_INCONSISTENT", retryable: false });
      continue;
    }

    // "verify release binding if the assessment contract carries it": LocalizationAssessmentPayload
    // (packages/mps-lu/src/artifacts/LocalizationAssessmentArtifact.ts) has no release-ref field
    // today, so there is nothing further to check here -- not a gap, just not part of this
    // artifact's current contract.

    verified.push(assessment);
  }

  if (faults.length > 0) {
    // OD-R1/OD-R2: the current assessment cannot be determined; no other candidate stands in.
    throw new AssessmentProjectionCandidateUnverifiableError(faults);
  }

  if (contractVersionRefusal !== null) {
    throw contractVersionRefusal;
  }

  if (verified.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no candidate for the current binding survived CAS re-verification");
  }

  if (verified.length > 1) {
    // More than one genuinely distinct, independently verified assessment for the same current
    // binding/geometry has no declared semantic currentness relation. Do not let projection
    // registration/rebuild order, row order, timestamps, or artifact ids invent one.
    throw new Error(
      "REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT: multiple verified assessment candidates for the current binding/geometry",
    );
  }

  return { assessmentArtifactId: verified[0]!.artifact_id };
}

export type AssessmentProjectionReconciliationResult =
  | { readonly reconciled: true }
  | { readonly reconciled: false; readonly reason: "MISSING_CAS_ARTIFACT" | "TAMPERED_CAS_ARTIFACT" | "WRONG_TYPE" | "NOT_CURRENT" | "UNKNOWN_CONTRACT_VERSION" };

/**
 * P3-LU-ASSESSMENT-PROJECTION-RELIABILITY-01.
 *
 * Deterministic, idempotent recovery for a known write-path failure
 * (assessment_projection_registered === false on a real report response, or an operator
 * rebuilding the whole projection from CAS + known assessment refs). Never resolves the current
 * canonical context itself -- that would create a dependency from server/modules/localization
 * (this file) back onto the canonical project-context and ProductRelease resolvers,
 * which already depend on server/modules/localization the other way. The caller resolves "what is
 * current right now" first (the same way the original write path did) and passes it in here.
 *
 * Refuses to reconcile (returns `NOT_CURRENT`, never throws for this case) when the assessment's
 * own `project_context_ref` does not match the caller-supplied current canonical context -- this
 * is what makes "wrong project/binding cannot be repaired into current state" true: an assessment
 * genuinely computed under a since-superseded context stays historical, never silently promoted.
 *
 * Does NOT catch a projection-store failure (e.g. `index.register` throwing because the
 * projection DB is unavailable) -- that propagates to the caller so it is observable, not
 * logger-only.
 */
export async function reconcileAssessmentProjection(args: {
  readonly projectId: string;
  readonly assessmentArtifactId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly currentProjectContextRef: ArtifactReference;
  readonly currentBindingRef: ArtifactReference;
  readonly currentReleaseRef: ArtifactReference;
  readonly index?: ProjectAssessmentProjectionIndex;
}): Promise<AssessmentProjectionReconciliationResult> {
  // W-CATCH2 #16 (OD-R2): MISSING_CAS_ARTIFACT only for the repository's proven "never stored" for this
  // id; any other read failure propagates as a typed LuReadFaultError (like the projection-store failure
  // below), so an operator run never records a read error as a missing artifact.
  const read = await readExistingOrProvenAbsent<LocalizationAssessmentArtifact>(
    args.artifactRepository,
    { artifact_id: args.assessmentArtifactId, artifact_type: "LOCALIZATION_ASSESSMENT" },
    "assessment",
  );
  if (!read.found) {
    return { reconciled: false, reason: "MISSING_CAS_ARTIFACT" };
  }
  const assessment = read.value;

  if (assessment.artifact_type !== "LOCALIZATION_ASSESSMENT") {
    return { reconciled: false, reason: "WRONG_TYPE" };
  }

  const recomputed = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
  const untampered =
    sameHash(assessment.content_hash, recomputed) &&
    assessment.artifact_id === `assessment-${recomputed.value}`;
  if (!untampered) {
    return { reconciled: false, reason: "TAMPERED_CAS_ARTIFACT" };
  }

  // H2/H12: explicit version dispatch, same rule as resolveCurrentAssessmentProjection above --
  // never silently reconcile an artifact carrying an unrecognized contract version.
  try {
    validateLocalizationAssessmentContractVersion(assessment.payload);
  } catch {
    // CATCH-REVIEWED: NOT_A_READ: validating the contract version of content already read; a refusal is UNKNOWN_CONTRACT_VERSION, never "missing".
    return { reconciled: false, reason: "UNKNOWN_CONTRACT_VERSION" };
  }

  if (!sameRef(assessment.payload.project_context_ref, args.currentProjectContextRef)) {
    // Genuinely valid, CAS-verified evidence -- just not for the CURRENT canonical state anymore
    // (the project's binding moved on since this assessment was computed). Historical, not current.
    return { reconciled: false, reason: "NOT_CURRENT" };
  }

  const index = args.index ?? new PrismaProjectAssessmentProjectionIndex();
  // Propagates on failure -- a caller (ops reconciliation run) must see this, not have it
  // swallowed a second time.
  await index.register({
    projectId: args.projectId,
    assessmentArtifactId: assessment.artifact_id,
    assessmentArtifactType: assessment.artifact_type,
    projectContextRef: assessment.payload.project_context_ref,
    bindingArtifactId: args.currentBindingRef.artifact_id,
    releaseArtifactId: args.currentReleaseRef.artifact_id,
  });
  return { reconciled: true };
}
