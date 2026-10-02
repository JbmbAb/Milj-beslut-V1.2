/**
 * U30-R6b (U30R6-VERIFICATION finding 3; owner decision 2026-10-02/03: a PASS over an older/unbound artifact form must
 * never look like the same green verification as a fully bound one).
 *
 * This repository compiles with strictNullChecks OFF, so the type of a verify result alone cannot stop a consumer from
 * treating a PASS with a `null`/missing/unknown `verification_binding`, a DENY, or a strength whose notice is missing as
 * green -- e.g. `verification_binding !== "LEGACY_UNBOUND_FORM"` turns a DENY green. `classifyVerifyPresentation` is the
 * ONE safe way to decide what a verify result may be shown as. It is FAIL-CLOSED and takes `unknown`, so it judges the
 * package's result, its JSON round trip and the route's body alike:
 *  - "FULLY_BOUND_GREEN" only for outcome "PASS", no mismatches, a notices array without the legacy-unbound notice,
 *    and verification_binding exactly "FULLY_BOUND" -- consistency with the pinned artifacts, never authenticity;
 *  - "LEGACY_UNBOUND_NOTICE" only for outcome "PASS", no mismatches, verification_binding exactly
 *    "LEGACY_UNBOUND_FORM", and exactly one LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY notice, FIRST, with the owner's exact
 *    text, a known basis and both "verified" flags false -- to be shown with that text, never as green;
 *  - "NOT_VERIFIED" for everything else: a DENY, any other or missing shape, value or pairing.
 * Pure: no I/O, no environment, no clock.
 */
import { LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV } from "./LuDeterministicReExecution.js";

const LEGACY_UNBOUND_FORM_NOTICE_CODE = "LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY";
const LEGACY_UNBOUND_BASES: ReadonlySet<unknown> = new Set(["V1_FORM", "LEGACY_UNBOUND"]);

function isLegacyUnboundFormNotice(notice: unknown): boolean {
  return typeof notice === "object" && notice !== null && (notice as { readonly code?: unknown }).code === LEGACY_UNBOUND_FORM_NOTICE_CODE;
}

export function classifyVerifyPresentation(result: unknown): "FULLY_BOUND_GREEN" | "LEGACY_UNBOUND_NOTICE" | "NOT_VERIFIED" {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return "NOT_VERIFIED";
  const candidate = result as Readonly<Record<string, unknown>>;
  if (candidate.outcome !== "PASS") return "NOT_VERIFIED";
  if (!Array.isArray(candidate.mismatches) || candidate.mismatches.length !== 0) return "NOT_VERIFIED";
  if (!Array.isArray(candidate.notices)) return "NOT_VERIFIED";
  const notices = candidate.notices as readonly unknown[];
  const legacy = notices.filter(isLegacyUnboundFormNotice);

  if (candidate.verification_binding === "FULLY_BOUND") {
    return legacy.length === 0 ? "FULLY_BOUND_GREEN" : "NOT_VERIFIED";
  }
  if (candidate.verification_binding === "LEGACY_UNBOUND_FORM") {
    if (legacy.length !== 1 || notices[0] !== legacy[0]) return "NOT_VERIFIED";
    const notice = legacy[0] as Readonly<Record<string, unknown>>;
    if (
      notice.text_sv !== LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV ||
      notice.authenticity_verified !== false ||
      notice.current_authority_verified !== false ||
      !LEGACY_UNBOUND_BASES.has(notice.basis)
    ) {
      return "NOT_VERIFIED";
    }
    return "LEGACY_UNBOUND_NOTICE";
  }
  return "NOT_VERIFIED";
}
