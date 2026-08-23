import type { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import type { ArtifactAttestation } from "@miljobeslut/mimers-brunn-core";

export const LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PURPOSE = "LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_V1" as const;
export const LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ARTIFACT_TYPE = "localization_geometry_supersession_issuer" as const;
export const LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_VERSION = "localization-geometry-supersession-issuer-v1" as const;
export const LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE = "localization_geometry_supersession" as const;

export const LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE = "localization_geometry_supersession" as const;
export const LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION = "LOCALIZATION_GEOMETRY_SUPERSESSION_V1" as const;

/** One-time legacy-data-migration reason -- see LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1
 *  Phase B contract point 3: this reconstructs the OLD product's observed createdAt-DESC
 *  currentness selection; it does NOT claim a signed supersession relation existed historically. */
export const LEGACY_CURRENTNESS_MIGRATION_REASON_CODE = "LEGACY_CURRENTNESS_MIGRATION_V1" as const;

function req(v: string, n: string): string {
  const x = (v ?? "").trim();
  if (!x) throw new Error(`REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION: ${n} is required`);
  return x;
}

function reqRef(v: ArtifactReference, n: string): ArtifactReference {
  if (!v || typeof v !== "object") throw new Error(`REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION: ${n} is required`);
  return {
    artifact_id: req(String(v.artifact_id ?? ""), `${n}.artifact_id`),
    artifact_type: req(String(v.artifact_type ?? ""), `${n}.artifact_type`),
  };
}

/**
 * LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B.
 *
 * A dedicated, self-signed issuing authority for `localization_geometry_supersession` artifacts
 * only -- deliberately separate from PROJECT_CONTEXT_BINDING_ISSUER (whose `allowed_artifact_types`
 * is a closed, structurally-validated tuple that does not, and must not, include this type; see
 * packages/mps-lu/src/artifacts/ProjectContextBindingIssuerArtifact.ts). Same shape as
 * ViewerCapabilityIssuerArtifact: possession of the private key alone does not establish
 * authority -- the issuer artifact carries a self-attestation plus an explicit
 * `owner_authority_ref`, and the runtime verifier additionally requires `issuer_key_id` to match
 * its own env-configured trusted key_id (the actual root of trust).
 */
export interface LocalizationGeometrySupersessionIssuerArtifact extends ArtifactContract {
  readonly artifact_type: typeof LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ARTIFACT_TYPE;
  readonly payload: {
    readonly issuer_key_id: string;
    readonly purpose: typeof LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PURPOSE;
    readonly allowed_artifact_type: typeof LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE;
    readonly owner_authority_ref: ArtifactReference;
    readonly issuer_version: typeof LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_VERSION;
  };
  readonly attestation?: ArtifactAttestation;
}

/**
 * The authoritative "geometry A has been superseded by geometry B" relation. The geometry
 * artifacts themselves stay unsigned, immutable, content-addressed user content (see
 * LocalizationGeometryArtifact.ts) -- authority lives here, on the currentness TRANSITION, never
 * on the content. `reason_code` is either a real user-action code (project-state transition) or
 * the explicit `LEGACY_CURRENTNESS_MIGRATION_V1` one-time backfill code -- never silently omitted.
 */
export interface LocalizationGeometrySupersessionArtifact extends ArtifactContract {
  readonly artifact_type: typeof LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE;
  readonly payload: {
    readonly contract_version: typeof LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION;
    readonly project_id: string;
    readonly predecessor_geometry_ref: ArtifactReference;
    readonly successor_geometry_ref: ArtifactReference;
    readonly reason_code: string;
    readonly issuer_ref: ArtifactReference;
    readonly issuer_key_id: string;
    readonly issued_at: string;
  };
  readonly attestation?: ArtifactAttestation;
}

export function createLocalizationGeometrySupersessionIssuerArtifact(input: {
  readonly issuer_key_id: string;
  readonly owner_authority_ref: ArtifactReference;
}): Omit<LocalizationGeometrySupersessionIssuerArtifact, "attestation"> {
  const payload = {
    issuer_key_id: req(input.issuer_key_id, "issuer_key_id"),
    purpose: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_PURPOSE,
    allowed_artifact_type: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ALLOWED_ARTIFACT_TYPE,
    owner_authority_ref: reqRef(input.owner_authority_ref, "owner_authority_ref"),
    issuer_version: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_VERSION,
  } as const;
  const i = sha256ContentHash({ artifact_type: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ARTIFACT_TYPE, payload });
  const a = {
    artifact_id: `localization-geometry-supersession-issuer-${i.value.slice(0, 24)}`,
    artifact_type: LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_ARTIFACT_TYPE,
    references: [payload.owner_authority_ref],
    payload,
  };
  return { ...a, content_hash: sha256ContentHash(a) };
}

function identity(payload: Omit<LocalizationGeometrySupersessionArtifact["payload"], "issued_at">) {
  const predecessor_geometry_ref = reqRef(payload.predecessor_geometry_ref, "predecessor_geometry_ref");
  const successor_geometry_ref = reqRef(payload.successor_geometry_ref, "successor_geometry_ref");
  if (
    predecessor_geometry_ref.artifact_id === successor_geometry_ref.artifact_id &&
    predecessor_geometry_ref.artifact_type === successor_geometry_ref.artifact_type
  ) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION: successor must differ from predecessor");
  }
  return {
    contract_version: LOCALIZATION_GEOMETRY_SUPERSESSION_VERSION,
    project_id: req(payload.project_id, "project_id"),
    predecessor_geometry_ref,
    successor_geometry_ref,
    reason_code: req(payload.reason_code, "reason_code"),
    issuer_ref: reqRef(payload.issuer_ref, "issuer_ref"),
    issuer_key_id: req(payload.issuer_key_id, "issuer_key_id"),
  };
}

export function createLocalizationGeometrySupersessionArtifact(
  input: LocalizationGeometrySupersessionArtifact["payload"],
): Omit<LocalizationGeometrySupersessionArtifact, "attestation"> {
  const payload = { ...identity(input), issued_at: req(input.issued_at, "issued_at") };
  const i = sha256ContentHash({
    canonicalizer_id: "rfc8785-sha256-v1",
    artifact_type: LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE,
    payload: identity(payload),
  });
  const a = {
    artifact_id: `localization-geometry-supersession-${i.value.slice(0, 24)}`,
    artifact_type: LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE,
    references: [payload.predecessor_geometry_ref, payload.successor_geometry_ref, payload.issuer_ref],
    payload,
  };
  return { ...a, content_hash: sha256ContentHash(a) };
}

export function validateLocalizationGeometrySupersessionArtifact(
  artifact: LocalizationGeometrySupersessionArtifact,
): LocalizationGeometrySupersessionArtifact {
  if (!artifact || artifact.artifact_type !== LOCALIZATION_GEOMETRY_SUPERSESSION_ARTIFACT_TYPE) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION: artifact_type");
  }
  const rebuilt = createLocalizationGeometrySupersessionArtifact(artifact.payload);
  if (
    artifact.artifact_id !== rebuilt.artifact_id ||
    artifact.content_hash?.value !== rebuilt.content_hash.value ||
    artifact.content_hash?.algorithm !== rebuilt.content_hash.algorithm
  ) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION: canonical identity or content hash");
  }
  if (JSON.stringify(artifact.references) !== JSON.stringify(rebuilt.references)) {
    throw new Error("REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION: references do not match payload");
  }
  return artifact;
}
