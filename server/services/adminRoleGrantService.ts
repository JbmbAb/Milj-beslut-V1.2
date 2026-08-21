/**
 * PRODUCT-ADMIN-AUTHORITY-BOOTSTRAP-01
 *
 * Closes the identity/authority conflation gap: BankID (via ensureMockAuthUser /
 * findAuthUserByBankId) or the org-invitation flow (orgInvitationService.acceptInvitation)
 * establish who a User is; this service is the only legitimate path by which that User's role
 * may become ADMIN, and it requires a verified, signed AdminRoleGrantArtifact to do it.
 *
 * Issuance (mintAdminRoleGrant) holds the ADMIN_ROLE_ISSUER private key indirectly via
 * adminRoleGrantSigningKey.ts. Verification/materialization (verifyAdminRoleGrant /
 * applyAdminRoleGrant) uses only adminRoleGrantVerifier.ts (public key). No HTTP route in this
 * unit exposes issuance -- it is an explicit, owner-run operation (script), never a
 * self-service "become admin" endpoint.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createArtifactAttestation, verifyArtifactAttestation } from '@miljobeslut/mimers-brunn-core';
import {
  ADMIN_ROLE_GRANT_AUTHORITY_SCOPE,
  ADMIN_ROLE_GRANT_CONTRACT_VERSION,
  adminRoleGrantArtifactId,
  createAdminRoleGrantArtifact,
  isDisqualifiedBankIdSubject,
  validateAdminRoleGrantArtifact,
  type AdminRoleGrantArtifact,
} from '@miljobeslut/mps-compliance/src/artifacts/AdminRoleGrantArtifact';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import { getAdminRoleGrantSigningProvider } from '../security/adminRoleGrantSigningKey';
import { getAdminRoleGrantVerifier } from '../security/adminRoleGrantVerifier';
import { prisma } from '../db/prisma';

const ATTESTATION_PREDICATE_TYPE = 'admin_role_grant_authorization' as const;

/**
 * Minimal, dedicated, content-addressed WORM store for AdminRoleGrantArtifact JSON. Deliberately
 * self-contained rather than reusing the unrelated, not-integrated mps-cas-boundary package
 * (never wired into this app's module resolution) -- this unit's persistence need is a single
 * immutable JSON blob, keyed by its own sha256, and does not warrant pulling in or wiring a
 * separate generic CAS package for it.
 */
const GRANT_CAS_ROOT = process.env.ADMIN_ROLE_GRANT_CAS_ROOT || path.join('.data', 'admin-role-grants');

function grantCasPath(hash: string): string {
  return path.join(GRANT_CAS_ROOT, `${hash}.json`);
}

function putGrantBytes(bytes: Buffer): { hash: string; existed: boolean } {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const filePath = grantCasPath(hash);
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath);
    if (Buffer.compare(existing, bytes) !== 0) {
      throw new AdminRoleGrantRejected(`CAS immutability violation: digest ${hash} already bound to different bytes`);
    }
    return { hash, existed: true };
  }
  fs.mkdirSync(GRANT_CAS_ROOT, { recursive: true });
  const tmpPath = path.join(GRANT_CAS_ROOT, `.tmp-${hash}-${process.pid}`);
  fs.writeFileSync(tmpPath, bytes);
  fs.renameSync(tmpPath, filePath);
  return { hash, existed: false };
}

function getGrantBytes(hash: string): Buffer | null {
  const filePath = grantCasPath(hash);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath);
}

export class AdminRoleGrantRejected extends Error {
  constructor(public readonly reason: string) {
    super(`FAIL_CLOSED: ${reason}`);
    this.name = 'AdminRoleGrantRejected';
  }
}

/**
 * Mints and persists a new AdminRoleGrantArtifact for `subjectUserId`. Fails closed (never
 * silently downgrades) if the subject is not a real BankID-authenticated identity:
 * `admin:<username>` (admin-console) and `mock-*` (BankID mock mode) are structurally rejected
 * before signing is even attempted.
 */
export async function mintAdminRoleGrant(input: {
  readonly subjectUserId: string;
  readonly issuerRef: ArtifactReference;
}): Promise<AdminRoleGrantArtifact> {
  const subject = await prisma.user.findUnique({
    where: { id: input.subjectUserId },
    select: { id: true, bankidId: true, organisationId: true, role: true },
  });
  if (!subject) {
    throw new AdminRoleGrantRejected(`subject_user_id '${input.subjectUserId}' does not exist`);
  }
  if (isDisqualifiedBankIdSubject(subject.bankidId)) {
    const kind = subject.bankidId.startsWith('admin:') ? 'admin-console identity' : 'BankID mock-mode identity';
    throw new AdminRoleGrantRejected(
      `subject ${subject.id} is a synthetic ${kind} ('${subject.bankidId.split(':')[0]}:...'), not a real BankID owner`,
    );
  }

  const signing = getAdminRoleGrantSigningProvider();
  const unsigned = createAdminRoleGrantArtifact({
    subject_user_id: subject.id,
    subject_bankid_id: subject.bankidId,
    granted_role: 'ADMIN',
    issuer_ref: input.issuerRef,
    issuer_key_id: signing.keyId,
    authority_scope: ADMIN_ROLE_GRANT_AUTHORITY_SCOPE,
    issued_at: new Date().toISOString(),
    contract_version: ADMIN_ROLE_GRANT_CONTRACT_VERSION,
  });

  const attestation = await createArtifactAttestation({
    subjectDigest: unsigned.content_hash.value,
    predicateType: ATTESTATION_PREDICATE_TYPE,
    predicate: {
      subject_user_id: unsigned.payload.subject_user_id,
      authority_scope: unsigned.payload.authority_scope,
      granted_role: unsigned.payload.granted_role,
    },
    signing,
  });

  const artifact: AdminRoleGrantArtifact = { ...unsigned, attestation };

  const bytes = Buffer.from(JSON.stringify(artifact), 'utf-8');
  putGrantBytes(bytes);

  return artifact;
}

export function grantCasContentHash(artifact: AdminRoleGrantArtifact): string {
  return createHash('sha256').update(Buffer.from(JSON.stringify(artifact), 'utf-8')).digest('hex');
}

/**
 * Verifies an AdminRoleGrantArtifact against the trusted PRODUCT_ADMIN_ROLE_ISSUER_V1 public
 * key and, when `expectedSubject` is supplied, against the actually-authenticated subject. Uses
 * only the verification-only key provider -- structurally cannot mint what it checks.
 */
export async function verifyAdminRoleGrant(
  artifact: AdminRoleGrantArtifact,
  expectedSubject?: { readonly userId: string; readonly bankidId: string },
): Promise<void> {
  let structurallyValid: AdminRoleGrantArtifact;
  try {
    structurallyValid = validateAdminRoleGrantArtifact(artifact);
  } catch (error) {
    throw new AdminRoleGrantRejected(error instanceof Error ? error.message : 'malformed grant');
  }

  const attestation = structurallyValid.attestation!;
  if (attestation.subjectDigest !== structurallyValid.content_hash.value) {
    throw new AdminRoleGrantRejected('attestation subjectDigest does not match grant content_hash (tampered grant)');
  }
  if (attestation.predicateType !== ATTESTATION_PREDICATE_TYPE) {
    throw new AdminRoleGrantRejected('attestation predicateType does not match admin_role_grant_authorization');
  }

  const verifier = getAdminRoleGrantVerifier();
  if (attestation.signer !== verifier.keyId) {
    throw new AdminRoleGrantRejected(
      `untrusted issuer: attestation signed by '${attestation.signer}', trusted issuer is '${verifier.keyId}'`,
    );
  }

  const signatureValid = await verifyArtifactAttestation(attestation, verifier);
  if (!signatureValid) {
    throw new AdminRoleGrantRejected('signature verification failed (tampered grant or unsigned/forged attestation)');
  }

  if (structurallyValid.payload.authority_scope !== ADMIN_ROLE_GRANT_AUTHORITY_SCOPE) {
    throw new AdminRoleGrantRejected(
      `issuer scope mismatch: grant declares '${structurallyValid.payload.authority_scope}', required '${ADMIN_ROLE_GRANT_AUTHORITY_SCOPE}'`,
    );
  }
  if (structurallyValid.payload.granted_role !== 'ADMIN') {
    throw new AdminRoleGrantRejected(`grant does not authorize ADMIN (granted_role='${structurallyValid.payload.granted_role}')`);
  }

  if (expectedSubject) {
    if (structurallyValid.payload.subject_user_id !== expectedSubject.userId) {
      throw new AdminRoleGrantRejected(
        `wrong subject: grant is for user '${structurallyValid.payload.subject_user_id}', not '${expectedSubject.userId}'`,
      );
    }
    if (structurallyValid.payload.subject_bankid_id !== expectedSubject.bankidId) {
      throw new AdminRoleGrantRejected('wrong bankid binding: grant subject_bankid_id does not match the authenticated identity');
    }
  }
}

/**
 * Verifies the grant and, only if verification passes, materializes it by setting
 * `User.role = 'ADMIN'`. This is the sole write path in this unit that transitions a user to
 * ADMIN via a grant (existing ensureAdminConsoleUser / ensureMockAuthUser / acceptInvitation
 * paths are untouched -- they remain what they always were: dev/ops or invitation-time role
 * assignment, not grant-based product ADMIN authority).
 */
export async function applyAdminRoleGrant(artifact: AdminRoleGrantArtifact): Promise<{ userId: string; role: 'ADMIN' }> {
  const subject = await prisma.user.findUnique({
    where: { id: artifact.payload.subject_user_id },
    select: { id: true, bankidId: true },
  });
  if (!subject) {
    throw new AdminRoleGrantRejected(`grant subject_user_id '${artifact.payload.subject_user_id}' does not exist`);
  }

  await verifyAdminRoleGrant(artifact, { userId: subject.id, bankidId: subject.bankidId });

  const updated = await prisma.user.update({
    where: { id: subject.id },
    data: { role: 'ADMIN' },
    select: { id: true, role: true },
  });

  return { userId: updated.id, role: 'ADMIN' };
}

/** Reads a previously-persisted grant back from the CAS by the sha256 hash of its own JSON bytes. */
export function readAdminRoleGrantFromCas(hash: string): AdminRoleGrantArtifact | null {
  const bytes = getGrantBytes(hash);
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf-8')) as AdminRoleGrantArtifact;
}

export { adminRoleGrantArtifactId };
