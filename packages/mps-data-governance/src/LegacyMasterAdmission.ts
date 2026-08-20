import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  canonicalizeStrict,
  createArtifactAttestation,
  verifyArtifactAttestation,
  type ArtifactAttestation,
  type CASRepository,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from '@miljobeslut/mimers-brunn-core';

import type { VerifiedSourceDefinition } from './SourceRegistry';

/**
 * P2-LM-BYGGNADER-LEGACY-MASTER-RECONCILIATION-ADMISSION-01
 *
 * This is deliberately not a QuarantineArtifact. A Master ZIP may be observed and admitted
 * today, while the original download event remains unknown forever. Keeping that distinction in
 * a separate artifact prevents a current governance act from impersonating historic acquisition.
 */
export const LEGACY_MASTER_ADMISSION_ARTIFACT_TYPE = 'LEGACY_MASTER_ADMISSION' as const;
export const LEGACY_MASTER_ADMISSION_SCHEMA_VERSION = 1 as const;
export const LEGACY_MASTER_ADMISSION_MODE = 'LEGACY_MASTER_RECONCILIATION_V1' as const;
export const LEGACY_MASTER_ADMISSION_ACTION = 'legacy_master.admit' as const;
export const LEGACY_MASTER_ADMISSION_PREDICATE_TYPE = 'mimers-brunn/legacy-master-admission/v1' as const;

const LM_BYGGNADER_SOURCE_ID = 'lantmateriet-stac-byggnader';
const LM_BYGGNADER_ADAPTER = 'LM_STAC_BYGGNADER_V1';
const LM_BYGGNADER_CONTENT_FAMILY = 'LANTMATERIET_STAC_BYGGNADER' as const;

export interface LegacyMasterAdmissionSourceRegistryRef {
  readonly source_id: typeof LM_BYGGNADER_SOURCE_ID;
  readonly registry_artifact_id: string;
  readonly source_content_hash: string;
}

export interface LegacyMasterLocalObjectRef {
  /** Exact local path inspected at admission time; it is not an assertion about historic capture. */
  readonly path: string;
  readonly filename: string;
  readonly size_bytes: number;
  readonly sha256: string;
}

export interface LegacyMasterHistoricalAcquisition {
  readonly status: 'UNKNOWN';
  readonly source_url: null;
  readonly item_updated: null;
  readonly retrieved_at: null;
  readonly manifest_ref: null;
  readonly quarantine_ref: null;
}

export interface LegacyMasterReconciliationBasis {
  /** Master archives use `NNNN.zip`; fresh STAC assets use `byggnad_knNNNN.zip`. */
  readonly filename_structure: 'NNNN.zip' | 'byggnad_knNNNN.zip';
  readonly internal_asset_name: string;
  readonly required_schema_fields: readonly ['objektidentitet', 'geometri'];
  readonly crs: 'EPSG:3006';
  readonly geometry_type: 'MULTIPOLYGON';
}

export interface LegacyMasterAdmissionPayload {
  readonly source_registry_ref: LegacyMasterAdmissionSourceRegistryRef;
  readonly local_object_ref: LegacyMasterLocalObjectRef;
  /** CAS reference established by the current byte observation, never a historic capture ref. */
  readonly current_byte_observation_ref: string;
  readonly content_family: typeof LM_BYGGNADER_CONTENT_FAMILY;
  readonly municipality_id: string;
  readonly internal_asset_name: string;
  readonly media_type: 'application/zip';
  readonly historical_acquisition: LegacyMasterHistoricalAcquisition;
  readonly reconciliation_basis: LegacyMasterReconciliationBasis;
  readonly admission_mode: typeof LEGACY_MASTER_ADMISSION_MODE;
  readonly admitted_at: string;
}

export interface LegacyMasterAdmissionAttestationPredicate {
  readonly action: typeof LEGACY_MASTER_ADMISSION_ACTION;
  readonly admission_id: string;
  readonly admission_content_hash: string;
  readonly source_id: typeof LM_BYGGNADER_SOURCE_ID;
  readonly registry_artifact_id: string;
  readonly source_content_hash: string;
  readonly local_object_sha256: string;
  readonly admission_mode: typeof LEGACY_MASTER_ADMISSION_MODE;
  readonly approver_actor_id: string;
  readonly approver_role: 'GOVERNANCE_REVIEWER';
  readonly attestation_schema_version: typeof LEGACY_MASTER_ADMISSION_SCHEMA_VERSION;
  readonly signer_key_id: string;
}

export interface LegacyMasterAdmissionArtifact {
  readonly artifact_id: string;
  readonly artifact_type: typeof LEGACY_MASTER_ADMISSION_ARTIFACT_TYPE;
  /** SHA-256 over every authority-bearing payload field, including the admission timestamp. */
  readonly content_hash: string;
  readonly payload: LegacyMasterAdmissionPayload;
  readonly admission_attestation: ArtifactAttestation;
}

export interface UnsignedLegacyMasterAdmissionArtifact {
  readonly artifact_id: string;
  readonly artifact_type: typeof LEGACY_MASTER_ADMISSION_ARTIFACT_TYPE;
  readonly content_hash: string;
  readonly payload: LegacyMasterAdmissionPayload;
}

export interface LegacyMasterAdmissionReference {
  readonly artifact_id: string;
  readonly artifact_content_ref: string;
  readonly current_byte_observation_ref: string;
}

export class LegacyMasterAdmissionError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = 'LegacyMasterAdmissionError';
  }
}

function reject(reasonCode: string, message: string): never {
  throw new LegacyMasterAdmissionError(`${reasonCode}: ${message}`, reasonCode);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) reject('REJECT_LEGACY_MASTER_SHAPE', `${field} is required.`);
  return normalized;
}

function requireIsoTimestamp(value: string): string {
  const normalized = requireNonEmpty(value, 'admitted_at');
  if (Number.isNaN(Date.parse(normalized))) {
    reject('REJECT_LEGACY_MASTER_SHAPE', 'admitted_at must be an ISO timestamp.');
  }
  return normalized;
}

function requireSha256(value: string, field: string): string {
  const normalized = requireNonEmpty(value, field)
    .toLowerCase()
    .replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    reject('REJECT_LEGACY_MASTER_SHAPE', `${field} must be a SHA-256 hex digest.`);
  }
  return normalized;
}

function canonicalPayload(payload: LegacyMasterAdmissionPayload): Record<string, unknown> {
  return {
    artifact_type: LEGACY_MASTER_ADMISSION_ARTIFACT_TYPE,
    schema_version: LEGACY_MASTER_ADMISSION_SCHEMA_VERSION,
    source_registry_ref: payload.source_registry_ref,
    local_object_ref: payload.local_object_ref,
    current_byte_observation_ref: payload.current_byte_observation_ref,
    content_family: payload.content_family,
    municipality_id: payload.municipality_id,
    internal_asset_name: payload.internal_asset_name,
    media_type: payload.media_type,
    historical_acquisition: payload.historical_acquisition,
    reconciliation_basis: payload.reconciliation_basis,
    admission_mode: payload.admission_mode,
    admitted_at: payload.admitted_at,
  };
}

export function legacyMasterAdmissionContentHash(payload: LegacyMasterAdmissionPayload): string {
  return sha256(canonicalizeStrict(canonicalPayload(payload)));
}

export function legacyMasterAdmissionArtifactId(payload: LegacyMasterAdmissionPayload): string {
  return `legacy-master-admission-${legacyMasterAdmissionContentHash(payload)}`;
}

function assertVerifiedLmByggnaderSource(source: VerifiedSourceDefinition): void {
  if (source.sourceId !== LM_BYGGNADER_SOURCE_ID || source.adapter !== LM_BYGGNADER_ADAPTER) {
    reject(
      'REJECT_SOURCE_FAMILY',
      'legacy Master admission is limited to the verified Lantmateriet STAC byggnader source.',
    );
  }
}

function assertPayloadShape(payload: LegacyMasterAdmissionPayload): void {
  const sourceRef = payload.source_registry_ref;
  if (sourceRef.source_id !== LM_BYGGNADER_SOURCE_ID) {
    reject('REJECT_SOURCE_FAMILY', 'source_registry_ref.source_id must be lantmateriet-stac-byggnader.');
  }
  requireNonEmpty(sourceRef.registry_artifact_id, 'source_registry_ref.registry_artifact_id');
  requireSha256(sourceRef.source_content_hash, 'source_registry_ref.source_content_hash');

  const local = payload.local_object_ref;
  requireNonEmpty(local.path, 'local_object_ref.path');
  const fileMatch = /^(?:byggnad_kn)?(\d{4})\.zip$/i.exec(
    requireNonEmpty(local.filename, 'local_object_ref.filename'),
  );
  if (!fileMatch) {
    reject('REJECT_LOCAL_OBJECT', 'filename must match NNNN.zip or byggnad_knNNNN.zip.');
  }
  if (!Number.isSafeInteger(local.size_bytes) || local.size_bytes <= 0) {
    reject('REJECT_LOCAL_OBJECT', 'size_bytes must be a positive integer.');
  }
  requireSha256(local.sha256, 'local_object_ref.sha256');

  const municipalityId = requireNonEmpty(payload.municipality_id, 'municipality_id');
  if (municipalityId !== fileMatch[1]) {
    reject('REJECT_MUNICIPALITY_BINDING', 'municipality_id must match the local ZIP filename.');
  }
  if (payload.internal_asset_name !== `byggnad_kn${municipalityId}.gpkg`) {
    reject('REJECT_INTERNAL_ASSET', 'internal_asset_name must match the municipality-bound GPKG name.');
  }
  if (payload.current_byte_observation_ref !== `sha256:${local.sha256}`) {
    reject('REJECT_BYTE_OBSERVATION', 'current_byte_observation_ref must bind the local SHA-256.');
  }
  if (payload.content_family !== LM_BYGGNADER_CONTENT_FAMILY || payload.media_type !== 'application/zip') {
    reject(
      'REJECT_SOURCE_FAMILY',
      'content family and media type must be the fixed LM byggnader ZIP contract.',
    );
  }
  const historical = payload.historical_acquisition;
  if (
    historical.status !== 'UNKNOWN' ||
    historical.source_url !== null ||
    historical.item_updated !== null ||
    historical.retrieved_at !== null ||
    historical.manifest_ref !== null ||
    historical.quarantine_ref !== null
  ) {
    reject(
      'REJECT_HISTORICAL_PROVENANCE',
      'legacy admission must keep every historical acquisition field UNKNOWN/null.',
    );
  }
  const basis = payload.reconciliation_basis;
  if (
    (basis.filename_structure !== 'NNNN.zip' && basis.filename_structure !== 'byggnad_knNNNN.zip') ||
    basis.internal_asset_name !== payload.internal_asset_name ||
    basis.crs !== 'EPSG:3006' ||
    basis.geometry_type !== 'MULTIPOLYGON' ||
    basis.required_schema_fields[0] !== 'objektidentitet' ||
    basis.required_schema_fields[1] !== 'geometri'
  ) {
    reject(
      'REJECT_RECONCILIATION_BASIS',
      'the fixed LM byggnader reconciliation basis is incomplete or altered.',
    );
  }
  if (payload.admission_mode !== LEGACY_MASTER_ADMISSION_MODE) {
    reject('REJECT_ADMISSION_MODE', 'admission_mode must be LEGACY_MASTER_RECONCILIATION_V1.');
  }
  requireIsoTimestamp(payload.admitted_at);
}

export function createLegacyMasterAdmissionDraft(args: {
  readonly source: VerifiedSourceDefinition;
  readonly local_object_ref: LegacyMasterLocalObjectRef;
  readonly municipality_id: string;
  readonly internal_asset_name: string;
  readonly admitted_at: string;
}): UnsignedLegacyMasterAdmissionArtifact {
  assertVerifiedLmByggnaderSource(args.source);
  const payload: LegacyMasterAdmissionPayload = {
    source_registry_ref: {
      source_id: LM_BYGGNADER_SOURCE_ID,
      registry_artifact_id: args.source.registryArtifactId,
      source_content_hash: args.source.sourceContentHash,
    },
    local_object_ref: {
      path: args.local_object_ref.path,
      filename: args.local_object_ref.filename,
      size_bytes: args.local_object_ref.size_bytes,
      sha256: args.local_object_ref.sha256.toLowerCase().replace(/^sha256:/, ''),
    },
    current_byte_observation_ref: `sha256:${args.local_object_ref.sha256.toLowerCase().replace(/^sha256:/, '')}`,
    content_family: LM_BYGGNADER_CONTENT_FAMILY,
    municipality_id: args.municipality_id,
    internal_asset_name: args.internal_asset_name,
    media_type: 'application/zip',
    historical_acquisition: {
      status: 'UNKNOWN',
      source_url: null,
      item_updated: null,
      retrieved_at: null,
      manifest_ref: null,
      quarantine_ref: null,
    },
    reconciliation_basis: {
      filename_structure: /^\d{4}\.zip$/i.test(args.local_object_ref.filename)
        ? 'NNNN.zip'
        : 'byggnad_knNNNN.zip',
      internal_asset_name: args.internal_asset_name,
      required_schema_fields: ['objektidentitet', 'geometri'],
      crs: 'EPSG:3006',
      geometry_type: 'MULTIPOLYGON',
    },
    admission_mode: LEGACY_MASTER_ADMISSION_MODE,
    admitted_at: args.admitted_at,
  };
  assertPayloadShape(payload);
  const content_hash = legacyMasterAdmissionContentHash(payload);
  return {
    artifact_id: `legacy-master-admission-${content_hash}`,
    artifact_type: LEGACY_MASTER_ADMISSION_ARTIFACT_TYPE,
    content_hash,
    payload,
  };
}

export async function attestLegacyMasterAdmission(args: {
  readonly draft: UnsignedLegacyMasterAdmissionArtifact;
  readonly approver_actor_id: string;
  readonly signing: SigningKeyProvider;
}): Promise<LegacyMasterAdmissionArtifact> {
  const approver = requireNonEmpty(args.approver_actor_id, 'approver_actor_id');
  assertPayloadShape(args.draft.payload);
  const contentHash = legacyMasterAdmissionContentHash(args.draft.payload);
  const expectedId = `legacy-master-admission-${contentHash}`;
  if (args.draft.content_hash !== contentHash || args.draft.artifact_id !== expectedId) {
    reject('REJECT_ADMISSION_IDENTITY', 'draft identity does not match its canonical payload.');
  }

  const predicate: LegacyMasterAdmissionAttestationPredicate = {
    action: LEGACY_MASTER_ADMISSION_ACTION,
    admission_id: expectedId,
    admission_content_hash: contentHash,
    source_id: LM_BYGGNADER_SOURCE_ID,
    registry_artifact_id: args.draft.payload.source_registry_ref.registry_artifact_id,
    source_content_hash: args.draft.payload.source_registry_ref.source_content_hash,
    local_object_sha256: args.draft.payload.local_object_ref.sha256,
    admission_mode: LEGACY_MASTER_ADMISSION_MODE,
    approver_actor_id: approver,
    approver_role: 'GOVERNANCE_REVIEWER',
    attestation_schema_version: LEGACY_MASTER_ADMISSION_SCHEMA_VERSION,
    signer_key_id: args.signing.keyId,
  };
  const admission_attestation = await createArtifactAttestation({
    subjectDigest: `sha256:${contentHash}`,
    predicateType: LEGACY_MASTER_ADMISSION_PREDICATE_TYPE,
    predicate: predicate as unknown as Record<string, unknown>,
    signing: args.signing,
  });
  const artifact: LegacyMasterAdmissionArtifact = { ...args.draft, admission_attestation };
  await verifyLegacyMasterAdmissionArtifact(artifact, args.signing);
  return artifact;
}

/** Public-key-only validation. Runtime callers can never mint an admission. */
export async function verifyLegacyMasterAdmissionArtifact(
  artifact: LegacyMasterAdmissionArtifact,
  verification: VerificationKeyProvider,
): Promise<LegacyMasterAdmissionArtifact> {
  if (!artifact || artifact.artifact_type !== LEGACY_MASTER_ADMISSION_ARTIFACT_TYPE) {
    reject('REJECT_ARTIFACT_TYPE', 'artifact_type must be LEGACY_MASTER_ADMISSION.');
  }
  assertPayloadShape(artifact.payload);
  const contentHash = legacyMasterAdmissionContentHash(artifact.payload);
  const expectedId = `legacy-master-admission-${contentHash}`;
  const predicate = artifact.admission_attestation
    ?.predicate as Partial<LegacyMasterAdmissionAttestationPredicate>;
  const checks: readonly (readonly [boolean, string])[] = [
    [
      artifact.content_hash === contentHash && artifact.artifact_id === expectedId,
      'REJECT_ADMISSION_IDENTITY',
    ],
    [
      await verifyArtifactAttestation(artifact.admission_attestation, verification),
      'REJECT_ADMISSION_SIGNATURE',
    ],
    [
      artifact.admission_attestation.predicateType === LEGACY_MASTER_ADMISSION_PREDICATE_TYPE,
      'REJECT_ADMISSION_PREDICATE',
    ],
    [
      artifact.admission_attestation.signer === verification.keyId &&
        predicate.signer_key_id === verification.keyId,
      'REJECT_ADMISSION_SIGNER',
    ],
    [artifact.admission_attestation.subjectDigest === `sha256:${contentHash}`, 'REJECT_ADMISSION_SUBJECT'],
    [predicate.action === LEGACY_MASTER_ADMISSION_ACTION, 'REJECT_ADMISSION_ACTION'],
    [
      predicate.admission_id === expectedId && predicate.admission_content_hash === contentHash,
      'REJECT_ADMISSION_BINDING',
    ],
    [predicate.source_id === LM_BYGGNADER_SOURCE_ID, 'REJECT_SOURCE_FAMILY'],
    [
      predicate.registry_artifact_id === artifact.payload.source_registry_ref.registry_artifact_id,
      'REJECT_REGISTRY_BINDING',
    ],
    [
      predicate.source_content_hash === artifact.payload.source_registry_ref.source_content_hash,
      'REJECT_REGISTRY_BINDING',
    ],
    [predicate.local_object_sha256 === artifact.payload.local_object_ref.sha256, 'REJECT_BYTE_OBSERVATION'],
    [predicate.admission_mode === LEGACY_MASTER_ADMISSION_MODE, 'REJECT_ADMISSION_MODE'],
    [
      predicate.approver_role === 'GOVERNANCE_REVIEWER' &&
        typeof predicate.approver_actor_id === 'string' &&
        predicate.approver_actor_id.length > 0,
      'REJECT_ADMISSION_APPROVER',
    ],
    [
      predicate.attestation_schema_version === LEGACY_MASTER_ADMISSION_SCHEMA_VERSION,
      'REJECT_ADMISSION_SCHEMA',
    ],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) reject(failed[1], 'legacy Master admission verification failed.');
  return artifact;
}

/**
 * Owner-invoked persistence only. It verifies the signed admission and the bytes before any CAS
 * write. The raw CAS object is a current byte observation; it is deliberately not a manifest or
 * quarantine object.
 */
export async function persistLegacyMasterAdmission(args: {
  readonly artifact: LegacyMasterAdmissionArtifact;
  readonly verification: VerificationKeyProvider;
  readonly cas: CASRepository;
}): Promise<LegacyMasterAdmissionReference> {
  const artifact = await verifyLegacyMasterAdmissionArtifact(args.artifact, args.verification);
  const bytes = new Uint8Array(await readFile(artifact.payload.local_object_ref.path));
  const actualHash = sha256(bytes);
  if (actualHash !== artifact.payload.local_object_ref.sha256) {
    reject('REJECT_BYTE_OBSERVATION', 'local bytes do not match the signed SHA-256.');
  }
  if (bytes.byteLength !== artifact.payload.local_object_ref.size_bytes) {
    reject('REJECT_BYTE_OBSERVATION', 'local bytes do not match the signed size_bytes.');
  }

  const observed = await args.cas.putBytes(bytes);
  if (observed.hash !== artifact.payload.current_byte_observation_ref) {
    reject('REJECT_BYTE_OBSERVATION', 'CAS content identity does not match the signed byte observation.');
  }
  const persistedArtifact = await args.cas.putCanonical(artifact);
  return {
    artifact_id: artifact.artifact_id,
    artifact_content_ref: persistedArtifact.hash,
    current_byte_observation_ref: observed.hash,
  };
}

/** Resolves only a signed admission and its current observed bytes; no network or quarantine path exists here. */
export async function resolveLegacyMasterAdmission(args: {
  readonly reference: LegacyMasterAdmissionReference;
  readonly verification: VerificationKeyProvider;
  readonly cas: CASRepository;
}): Promise<{ readonly artifact: LegacyMasterAdmissionArtifact; readonly bytes: Uint8Array }> {
  const artifact = await args.cas.get<LegacyMasterAdmissionArtifact>(args.reference.artifact_content_ref);
  if (!artifact)
    reject('REJECT_UNPERSISTED_ADMISSION', 'legacy Master admission artifact is absent from CAS.');
  if (artifact.artifact_id !== args.reference.artifact_id) {
    reject('REJECT_ADMISSION_IDENTITY', 'reference artifact_id does not match persisted admission.');
  }
  await verifyLegacyMasterAdmissionArtifact(artifact, args.verification);
  const bytes = await args.cas.getBytes(args.reference.current_byte_observation_ref, { verifyHash: true });
  if (!bytes) reject('REJECT_UNPERSISTED_BYTE_OBSERVATION', 'current byte observation is absent from CAS.');
  if (sha256(bytes) !== artifact.payload.local_object_ref.sha256) {
    reject('REJECT_BYTE_OBSERVATION', 'resolved bytes no longer match the signed local object hash.');
  }
  return { artifact, bytes };
}
