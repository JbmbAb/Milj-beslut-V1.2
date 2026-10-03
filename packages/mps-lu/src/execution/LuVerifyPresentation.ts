/**
 * U30-R6b (U30R6-VERIFICATION finding 3; owner decision 2026-10-02/03: a PASS over an older/unbound artifact form must
 * never look like the same green verification as a fully bound one).
 *
 * This repository compiles with strictNullChecks OFF, so the type of a verify result alone cannot stop a consumer from
 * treating a PASS with a `null`/missing/unknown `verification_binding`, a DENY, or a strength whose notice is missing as
 * green -- e.g. `verification_binding !== "LEGACY_UNBOUND_FORM"` turns a DENY green. `classifyVerifyPresentation` is the
 * ONE safe way to decide what a verify result may be shown as. It is FAIL-CLOSED and takes `unknown`, so it judges the
 * package's result, its JSON round trip and the route's body alike:
 *  - "FULLY_BOUND_GREEN" only for outcome "PASS", no mismatches, verification_binding exactly "FULLY_BOUND" and notices
 *    that are at most one well-formed NOT_CHECKED_CAUSE_NOT_PINNED notice -- consistency with the pinned artifacts,
 *    never authenticity;
 *  - "LEGACY_UNBOUND_NOTICE" only for outcome "PASS", no mismatches, verification_binding exactly "LEGACY_UNBOUND_FORM",
 *    and exactly one well-formed LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY notice, FIRST (the owner's exact text, a known
 *    basis, both "verified" flags false, no finding ids, a detail), followed by at most one well-formed
 *    NOT_CHECKED_CAUSE_NOT_PINNED notice -- to be shown with that text, never as green;
 *  - "NOT_VERIFIED" for everything else: a DENY, any other or missing shape, value or pairing, an unknown or malformed
 *    notice.
 *
 * W-PLUMB-S (U30R6b-verification finding R6b-2) -- the classifier cannot be fooled by the input's FORM either:
 *  (a) it reads OWN DATA properties only (Object.getOwnPropertyDescriptor): an inherited field (Object.create, a polluted
 *      Object.prototype or Array.prototype, a hole in an array) is absent, and a getter is never invoked -- an accessor
 *      where data is expected is malformed;
 *  (b) anything that throws while being read (a throwing Proxy trap, a revoked Proxy) is NOT_VERIFIED, never an
 *      exception; every property is read EXACTLY ONCE and every decision is taken on that one read, so a stateful Proxy
 *      cannot show one value to one check and another to the next;
 *  (c) only the two known notice shapes are accepted, each at most once: an unknown or malformed notice next to either
 *      strength is NOT_VERIFIED;
 *  (d) nothing is walked recursively, and an array longer than a well-formed result can hold (notices > 2, mismatches > 0,
 *      finding ids > MAX_FINDING_IDS) is refused by its length alone, so cyclic and enormous structures are safe.
 * Pure: no I/O, no environment, no clock.
 */
import { LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV } from "./LuDeterministicReExecution.js";

const LEGACY_UNBOUND_FORM_NOTICE_CODE = "LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY";
const NOT_CHECKED_CAUSE_NOT_PINNED_NOTICE_CODE = "NOT_CHECKED_CAUSE_NOT_PINNED";
const LEGACY_UNBOUND_BASES: ReadonlySet<unknown> = new Set(["V1_FORM", "LEGACY_UNBOUND"]);
/** A well-formed result carries at most the legacy notice and one NOT_CHECKED notice. */
const MAX_NOTICES = 2;
/** One NOT_CHECKED finding id per governed layer; far more than any LU rule set has. */
const MAX_FINDING_IDS = 64;

type VerifyPresentation = "FULLY_BOUND_GREEN" | "LEGACY_UNBOUND_NOTICE" | "NOT_VERIFIED";

/** Thrown inside the classifier for any malformed form; the one catch below turns it (and any other throw) into NOT_VERIFIED. */
class MalformedVerifyResult extends Error {}

/** A plain object (not null, not an array, not a function). */
function isRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value of an OWN DATA property, read once; undefined when absent (inherited counts as absent). A getter is malformed. */
function ownData(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor)) throw new MalformedVerifyResult(key);
  return descriptor.value;
}

/** The own elements of an array, each read once, refused by its length alone when it is longer than `max`; null if not an array. */
function ownElements(value: unknown, max: number): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  const length = ownData(value, "length");
  if (typeof length !== "number" || length > max) throw new MalformedVerifyResult("length");
  const elements: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) throw new MalformedVerifyResult(String(index));
    elements.push(descriptor.value);
  }
  return elements;
}

/** A non-empty string read as own data. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The notice's code (own data), or a malformed form. */
function noticeCode(notice: unknown): unknown {
  if (!isRecord(notice)) throw new MalformedVerifyResult("notice");
  return ownData(notice, "code");
}

/** A well-formed NOT_CHECKED_CAUSE_NOT_PINNED notice (the code already read): finding ids that are non-empty strings, a detail. */
function assertWellFormedNotChecked(notice: object): void {
  const findingIds = ownElements(ownData(notice, "finding_ids"), MAX_FINDING_IDS);
  if (findingIds === null || !findingIds.every(isNonEmptyString)) throw new MalformedVerifyResult("finding_ids");
  if (typeof ownData(notice, "detail") !== "string") throw new MalformedVerifyResult("detail");
}

/** A well-formed legacy-unbound notice (the code already read): the owner's exact text, a known basis, both flags false. */
function assertWellFormedLegacyUnbound(notice: object): void {
  if (ownData(notice, "text_sv") !== LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV) throw new MalformedVerifyResult("text_sv");
  if (ownData(notice, "authenticity_verified") !== false) throw new MalformedVerifyResult("authenticity_verified");
  if (ownData(notice, "current_authority_verified") !== false) throw new MalformedVerifyResult("current_authority_verified");
  if (!LEGACY_UNBOUND_BASES.has(ownData(notice, "basis"))) throw new MalformedVerifyResult("basis");
  const findingIds = ownElements(ownData(notice, "finding_ids"), 0);
  if (findingIds === null) throw new MalformedVerifyResult("finding_ids");
  if (typeof ownData(notice, "detail") !== "string") throw new MalformedVerifyResult("detail");
}

function classify(result: unknown): VerifyPresentation {
  if (!isRecord(result)) return "NOT_VERIFIED";
  // Each field read exactly once, in this order; every decision below uses these values only.
  const outcome = ownData(result, "outcome");
  const mismatches = ownElements(ownData(result, "mismatches"), 0);
  const notices = ownElements(ownData(result, "notices"), MAX_NOTICES);
  const binding = ownData(result, "verification_binding");
  if (outcome !== "PASS" || mismatches === null || notices === null) return "NOT_VERIFIED";

  const codes = notices.map(noticeCode);
  const legacyAt = codes.indexOf(LEGACY_UNBOUND_FORM_NOTICE_CODE);
  // Only the two known codes, each at most once.
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (code !== LEGACY_UNBOUND_FORM_NOTICE_CODE && code !== NOT_CHECKED_CAUSE_NOT_PINNED_NOTICE_CODE) return "NOT_VERIFIED";
    if (codes.indexOf(code) !== index) return "NOT_VERIFIED";
    const notice = notices[index] as object;
    if (code === NOT_CHECKED_CAUSE_NOT_PINNED_NOTICE_CODE) assertWellFormedNotChecked(notice);
    else assertWellFormedLegacyUnbound(notice);
  }

  if (binding === "FULLY_BOUND") return legacyAt === -1 ? "FULLY_BOUND_GREEN" : "NOT_VERIFIED";
  if (binding === "LEGACY_UNBOUND_FORM") return legacyAt === 0 ? "LEGACY_UNBOUND_NOTICE" : "NOT_VERIFIED";
  return "NOT_VERIFIED";
}

export function classifyVerifyPresentation(result: unknown): "FULLY_BOUND_GREEN" | "LEGACY_UNBOUND_NOTICE" | "NOT_VERIFIED" {
  try {
    return classify(result);
  } catch {
    // A malformed form, a throwing getter or Proxy trap, a revoked Proxy: never an exception, never green.
    return "NOT_VERIFIED";
  }
}
