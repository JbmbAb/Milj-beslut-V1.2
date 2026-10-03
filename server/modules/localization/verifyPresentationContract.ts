/**
 * W-PLUMB-S -- the CONTRACT of the verify answer between the server and the LU UI
 * (POST /api/localization/:projectId/verify-assessment).
 *
 * Owner decision 2026-10-02 (BINDING): the V1 form is accepted until U51 as a product limitation, WITH a mandatory
 * machine-readable notice on every PASS over a V1/legacy-unbound artifact form; such a PASS must NEVER look like the
 * same green verification as a fully bound V4. verify is CONSISTENCY with the pinned artifacts, NOT authenticity:
 * attestation verification is blocking before PRODUCT-PROVEN.
 *
 * TYPES ONLY: this file has no import and no runtime value, so the UI can `import type` it without pulling
 * @miljobeslut/mps-lu (or any server code) into the client bundle. The answer carries everything the UI needs.
 *
 * What the server guarantees (server/modules/localization/verifyPresentation.ts, one source):
 *  - `presentation` is computed IN THE SERVER with classifyVerifyPresentation from the @miljobeslut/mps-lu package root,
 *    and it is the class of the answer's own machine fields (outcome, mismatches, notices, verification_binding): the
 *    same function over this JSON gives the same class. Fail-closed: anything missing, unknown or inconsistent is
 *    "NOT_VERIFIED".
 *  - The UI may show green ONLY for presentation === "FULLY_BOUND_GREEN". "LEGACY_UNBOUND_NOTICE" is shown with
 *    `outcome_sv` (the owner's text), never green. Everything else -- "NOT_VERIFIED", and a missing or unknown value --
 *    is not green. `outcome === "PASS"` alone never decides green.
 *  - `verification_binding` is null whenever presentation is "NOT_VERIFIED" (also for a PASS whose strength could not be
 *    established), "FULLY_BOUND" only with "FULLY_BOUND_GREEN", "LEGACY_UNBOUND_FORM" only with "LEGACY_UNBOUND_NOTICE".
 *  - `outcome_sv` (the Swedish main text):
 *      "FULLY_BOUND_GREEN"     -> today's text: "Reproducerbarhet verifierad – resultatet matchar de pinnade
 *                                 artefakterna." (with the NOT_CHECKED_CAUSE_NOT_PINNED clause when that notice is present);
 *      "LEGACY_UNBOUND_NOTICE" -> EXACTLY the owner's text, the same string as notices[0].text_sv:
 *                                 "Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell
 *                                 authority är inte verifierade." -- never the green sentence;
 *      "NOT_VERIFIED"          -> a neutral text: a DENY keeps its DENY text (EXECUTION_SUBJECT_UNBOUND: that mismatch's own
 *                                 text_sv); any other answer that is not verified gets the server's neutral "kan inte visas
 *                                 som verifierad" text. Never a claim of tampering, never green.
 *  - On "FULLY_BOUND_GREEN" and "LEGACY_UNBOUND_NOTICE" every notice is one of the two shapes below (the legacy notice
 *    exactly once and first on "LEGACY_UNBOUND_NOTICE", never on "FULLY_BOUND_GREEN"). On "NOT_VERIFIED" the notices are
 *    passed on as the re-execution returned them: the UI must not derive any presentation from them.
 */

/** The presentation class of a verify answer (classifyVerifyPresentation, computed in the server). */
export type LuVerifyPresentation = 'FULLY_BOUND_GREEN' | 'LEGACY_UNBOUND_NOTICE' | 'NOT_VERIFIED';

/** The binding strength of a PASS whose presentation is not "NOT_VERIFIED"; otherwise null. */
export type LuVerifyBinding = 'FULLY_BOUND' | 'LEGACY_UNBOUND_FORM';

/** Which detectable older/unbound form a LEGACY_UNBOUND_FORM PASS rests on. */
export type LuVerifyLegacyUnboundBasis = 'V1_FORM' | 'LEGACY_UNBOUND';

/** The mandatory notice of a PASS over a V1/legacy-unbound form (U30-R6). */
export interface LuVerifyLegacyUnboundFormNotice {
  readonly code: 'LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY';
  readonly basis: LuVerifyLegacyUnboundBasis;
  readonly authenticity_verified: false;
  readonly current_authority_verified: false;
  /** Exactly the owner's text (see the header). */
  readonly text_sv: string;
  /** Always empty: the notice is about the whole verification. */
  readonly finding_ids: readonly [];
  /** Technical detail (ids only), for "Teknisk information". */
  readonly detail: string;
}

/** U30-R2: the stored cause text of the listed NOT_CHECKED layers was never pinned (not a deviation). */
export interface LuVerifyNotCheckedCauseNotPinnedNotice {
  readonly code: 'NOT_CHECKED_CAUSE_NOT_PINNED';
  readonly finding_ids: readonly string[];
  readonly detail: string;
}

export type LuVerifyNotice = LuVerifyLegacyUnboundFormNotice | LuVerifyNotCheckedCauseNotPinnedNotice;

/** A deviation of a DENY; only EXECUTION_SUBJECT_UNBOUND carries its own Swedish text. */
export interface LuVerifyMismatch {
  readonly code: string;
  readonly detail: string;
  readonly text_sv?: string;
}

/** The 200 answer of the verify route. The fields of the earlier answer are kept; the last three are new. */
export interface LuVerifyAssessmentAnswer {
  readonly ok: true;
  readonly outcome: 'PASS' | 'DENY';
  readonly assessmentArtifactId: string;
  readonly mismatches: readonly LuVerifyMismatch[];
  readonly notices: readonly LuVerifyNotice[];
  /** null whenever presentation is "NOT_VERIFIED". */
  readonly verification_binding: LuVerifyBinding | null;
  readonly presentation: LuVerifyPresentation;
  readonly outcome_sv: string;
}

/**
 * The verify route's typed configuration error (503, never retryable): MPS_LU_BOOTSTRAP_ADMIT is set in a process that
 * is not an explicit test process. Answered BEFORE any database or CAS read of the route (also before authentication,
 * whose token check reads the database). Not a verification outcome and not a fault of the assessment. `error` is a
 * fixed Swedish text without any environment value.
 */
export interface LuVerifyConfigurationErrorAnswer {
  readonly ok: false;
  readonly code: 'BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST';
  readonly retryable: false;
  readonly error: string;
}
