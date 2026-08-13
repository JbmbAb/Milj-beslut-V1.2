/**
 * 🜃 Spatial engine fingerprint (P4A-LU-S1 / S2 / S3)
 *
 * OWNER FREEZE 2026-08-13 — SPATIAL_STACK_V1.
 *
 * TV-S1 §5.2: *substituting an engine produces a new evidence identity, not an equal one.*
 *
 * Two defects are closed together because they are one defect seen from two sides:
 *
 *   S1  the production provider pinned `postgis: "3.x"` — the literal wildcard SV-I03 forbids
 *   S3  no provider named the full stack; GEOS, PROJ and GDAL were absent
 *   S2  the artifact CARRIED a fingerprint that the identity domain did not BIND, so two
 *       artifacts computed on different stacks could share an identity
 *
 * S2 is the architecturally worst of the three: a wildcard is visibly wrong, whereas an
 * unbound fingerprint looks correct and silently collapses distinct executions into one
 * identity.
 *
 * A future move to e.g. PostGIS 3.5 SHALL yield new evidence identities. That is the contract
 * working, not a migration bug.
 *
 * ⚠️ KNOWN GAP — this constant ASSERTS the execution stack; nothing verifies it against the
 * database actually answering the query (`PostGIS_Full_Version()` and friends). Pinning before
 * evidence production is what SPC-R09 requires and is therefore correct now, but an unverified
 * pin can drift from reality. Registered as a separate gate concern; deliberately NOT
 * implemented in this work unit.
 *
 * @see docs/architecture/P4A-LU-GATE-CONTRACT-2026-08-11.md §5
 * @see docs/architecture/TV-4.3-Spatial-Processing-Compatibility.md §9 (verified baseline)
 */

/** The four components that together determine a spatial computation's result. */
export const SPATIAL_STACK_COMPONENTS = ["postgis", "geos", "proj", "gdal"] as const;

export type SpatialStackComponent = (typeof SPATIAL_STACK_COMPONENTS)[number];

/**
 * Exact versions only. Typed as a total record so omitting a component is a compile error,
 * not a runtime discovery.
 */
export type SpatialEngineFingerprint = Readonly<Record<SpatialStackComponent, string>>;

/**
 * v1 — the TV-4.3 §9 verified baseline.
 *
 * These are not "the best versions"; they are a statement of exactly which implementation
 * stack produced a given piece of evidence. Upgrading the environment means upgrading FIRST
 * and pinning the real versions afterwards — never editing this constant to match an
 * aspiration.
 */
export const SPATIAL_STACK_V1: SpatialEngineFingerprint = Object.freeze({
  postgis: "3.4.3",
  geos: "3.9.0",
  proj: "7.2.1",
  gdal: "3.2.2",
});

export const SPATIAL_STACK_VERSION_ID = "spatial-stack/v1" as const;

export class SpatialEngineFingerprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpatialEngineFingerprintError";
  }
}

/** Exact three-part version. Anything approximate is rejected outright. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Fail-closed validation of a fingerprint before it may participate in an identity.
 *
 * Gathers every check before throwing, same discipline as `verifyDocumentFactCandidate()` and
 * `CorpusImportGate.importBatch()`.
 */
export function assertExactEngineFingerprint(
  fingerprint: Readonly<Record<string, string>> | undefined,
): asserts fingerprint is SpatialEngineFingerprint {
  if (!fingerprint || typeof fingerprint !== "object") {
    throw new SpatialEngineFingerprintError(
      "REJECT_ENGINE_FINGERPRINT: a fingerprint is mandatory; evidence may not be produced " +
        "without naming the stack that computed it.",
    );
  }

  const missing = SPATIAL_STACK_COMPONENTS.filter((c) => !fingerprint[c]);
  if (missing.length > 0) {
    throw new SpatialEngineFingerprintError(
      `REJECT_ENGINE_FINGERPRINT: incomplete stack — missing ${missing.join(", ")}. ` +
        "SV-I03 requires the full required fingerprint, because a difference in any one of " +
        "these can change the spatial result.",
    );
  }

  // An unknown key is rejected rather than ignored: the production provider carried `srid`
  // inside the fingerprint, which conflates a query parameter with the execution stack.
  const unknown = Object.keys(fingerprint).filter(
    (k) => !(SPATIAL_STACK_COMPONENTS as readonly string[]).includes(k),
  );
  if (unknown.length > 0) {
    throw new SpatialEngineFingerprintError(
      `REJECT_ENGINE_FINGERPRINT: unknown component(s) ${unknown.join(", ")}. The fingerprint ` +
        "names the execution stack and nothing else.",
    );
  }

  const inexact = SPATIAL_STACK_COMPONENTS.filter((c) => !EXACT_VERSION.test(fingerprint[c]));
  if (inexact.length > 0) {
    throw new SpatialEngineFingerprintError(
      `REJECT_ENGINE_FINGERPRINT: non-exact version for ${inexact.join(", ")} ` +
        `(${inexact.map((c) => `${c}=${fingerprint[c]}`).join(", ")}). ` +
        "SV-I03 forbids wildcards and ranges: '3.x' does not identify an execution.",
    );
  }
}

export function isExactEngineFingerprint(
  fingerprint: Readonly<Record<string, string>> | undefined,
): fingerprint is SpatialEngineFingerprint {
  try {
    assertExactEngineFingerprint(fingerprint);
    return true;
  } catch {
    return false;
  }
}
