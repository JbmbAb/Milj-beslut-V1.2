import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArtifactAttestation, verifyArtifactAttestation, type VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
import type { ActorReference } from '@miljobeslut/mps-core/src/types';
import {
  GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE,
  GOVERNANCE_REVIEWER_GRANT_PREDICATE_TYPE,
  createGovernanceReviewerGrantArtifact,
  isDisqualifiedGovernanceReviewerSubject,
  validateGovernanceReviewerGrantArtifact,
  type GovernanceReviewerGrantArtifact,
} from '@miljobeslut/mps-compliance/src/artifacts/GovernanceReviewerGrantArtifact';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import { prisma } from '../db/prisma';
import { getGovernanceReviewerGrantSigningProvider } from '../security/governanceReviewerGrantSigningKey';
import { getGovernanceReviewerGrantVerifier } from '../security/governanceReviewerGrantVerifier';
import type { AuthUser } from '../security/types';

type GovernanceReviewerSubject = Readonly<{ id: string; bankidId: string; identityEnvironment: string }>;
type GovernanceReviewerSubjectRepository = Readonly<{ findById(id: string): Promise<GovernanceReviewerSubject | null> }>;

const defaultSubjects: GovernanceReviewerSubjectRepository = {
  async findById(id) {
    const subject = await prisma.user.findUnique({
      where: { id },
      select: { id: true, bankidId: true, identityEnvironment: true },
    });
    return subject ? { ...subject } : null;
  },
};

function grantRoot(): string {
  return process.env.GOVERNANCE_REVIEWER_GRANT_CAS_ROOT || join('.data', 'governance-reviewer-grants');
}

function eligibleIdentity(subject: GovernanceReviewerSubject): boolean {
  // TEST is an actual BankID test-environment identity, unlike mock/admin synthetic identities.
  return (subject.identityEnvironment === 'PRODUCTION' || subject.identityEnvironment === 'TEST') &&
    !isDisqualifiedGovernanceReviewerSubject(subject.bankidId);
}

function persistGrant(artifact: GovernanceReviewerGrantArtifact): void {
  const bytes = Buffer.from(JSON.stringify(artifact), 'utf8');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const root = grantRoot();
  const destination = join(root, `${hash}.json`);
  if (existsSync(destination)) {
    if (Buffer.compare(readFileSync(destination), bytes) !== 0) {
      throw new GovernanceReviewerGrantRejected(`grant store hash ${hash} is bound to different bytes`);
    }
    return;
  }
  mkdirSync(root, { recursive: true });
  const temporary = join(root, `.tmp-${hash}-${process.pid}`);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, destination);
}

function readStoredGrants(): GovernanceReviewerGrantArtifact[] {
  const root = grantRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as GovernanceReviewerGrantArtifact);
}

export class GovernanceReviewerGrantRejected extends Error {
  constructor(reason: string) { super(`FAIL_CLOSED: ${reason}`); this.name = 'GovernanceReviewerGrantRejected'; }
}

export async function mintGovernanceReviewerGrant(input: {
  readonly subjectUserId: string;
  readonly issuerRef: ArtifactReference;
  readonly issuedAt?: string;
}, dependencies: { readonly subjects?: GovernanceReviewerSubjectRepository } = {}): Promise<GovernanceReviewerGrantArtifact> {
  const subject = await (dependencies.subjects ?? defaultSubjects).findById(input.subjectUserId);
  if (!subject) throw new GovernanceReviewerGrantRejected(`subject_user_id '${input.subjectUserId}' does not exist`);
  if (!eligibleIdentity(subject)) {
    throw new GovernanceReviewerGrantRejected(`subject '${subject.id}' is not a real authenticated BankID identity eligible for governance review`);
  }
  const signing = getGovernanceReviewerGrantSigningProvider();
  const unsigned = createGovernanceReviewerGrantArtifact({
    subject_user_id: subject.id,
    subject_bankid_id: subject.bankidId,
    granted_role: 'GOVERNANCE_REVIEWER',
    issuer_ref: input.issuerRef,
    issuer_key_id: signing.keyId,
    authority_scope: GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE,
    issued_at: input.issuedAt ?? new Date().toISOString(),
    contract_version: 'governance-reviewer-grant-v1',
  });
  const attestation = await createArtifactAttestation({
    subjectDigest: unsigned.content_hash.value,
    predicateType: GOVERNANCE_REVIEWER_GRANT_PREDICATE_TYPE,
    predicate: {
      subject_user_id: unsigned.payload.subject_user_id,
      subject_bankid_id: unsigned.payload.subject_bankid_id,
      granted_role: unsigned.payload.granted_role,
      authority_scope: unsigned.payload.authority_scope,
      signer_key_id: signing.keyId,
    },
    signing,
  });
  const artifact: GovernanceReviewerGrantArtifact = { ...unsigned, attestation };
  persistGrant(artifact);
  return artifact;
}

export async function verifyGovernanceReviewerGrant(
  artifact: GovernanceReviewerGrantArtifact,
  expectedSubject: Readonly<{ userId: string; bankidId: string }>,
  verification: VerificationKeyProvider = getGovernanceReviewerGrantVerifier(),
): Promise<void> {
  let grant: GovernanceReviewerGrantArtifact;
  try {
    grant = validateGovernanceReviewerGrantArtifact(artifact);
  } catch (error) {
    throw new GovernanceReviewerGrantRejected(error instanceof Error ? error.message : 'malformed reviewer grant');
  }
  const predicate = grant.attestation!.predicate as Record<string, unknown>;
  const checks: readonly (readonly [boolean, string])[] = [
    [grant.attestation!.subjectDigest === grant.content_hash.value, 'attestation subject digest does not match grant content hash'],
    [grant.attestation!.predicateType === GOVERNANCE_REVIEWER_GRANT_PREDICATE_TYPE, 'attestation predicate type is wrong'],
    [grant.attestation!.signer === verification.keyId && predicate.signer_key_id === verification.keyId, 'issuer signer is not trusted for governance reviewer grants'],
    [await verifyArtifactAttestation(grant.attestation!, verification), 'issuer signature is invalid'],
    [grant.payload.subject_user_id === expectedSubject.userId, 'grant subject user does not match authenticated user'],
    [grant.payload.subject_bankid_id === expectedSubject.bankidId, 'grant BankID identity does not match authenticated user'],
    [predicate.subject_user_id === grant.payload.subject_user_id && predicate.subject_bankid_id === grant.payload.subject_bankid_id, 'signed predicate does not bind the grant subject'],
    [predicate.granted_role === 'GOVERNANCE_REVIEWER' && predicate.authority_scope === GOVERNANCE_REVIEWER_GRANT_AUTHORITY_SCOPE, 'signed predicate does not bind GOVERNANCE_REVIEWER scope'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new GovernanceReviewerGrantRejected(failed[1]);
}

/** Resolves an ActorReference from verified grant state; no request can supply this authority. */
export async function resolveGovernanceReviewerActor(
  authenticatedUser: AuthUser,
  dependencies: { readonly subjects?: GovernanceReviewerSubjectRepository; readonly verification?: VerificationKeyProvider } = {},
): Promise<ActorReference> {
  const subject = await (dependencies.subjects ?? defaultSubjects).findById(authenticatedUser.id);
  if (!subject || subject.bankidId !== authenticatedUser.bankidId || !eligibleIdentity(subject)) {
    throw new GovernanceReviewerGrantRejected('authenticated user has no eligible canonical BankID identity');
  }
  const verification = dependencies.verification ?? getGovernanceReviewerGrantVerifier();
  const matching = readStoredGrants().filter((grant) => grant.payload?.subject_user_id === subject.id);
  const valid: GovernanceReviewerGrantArtifact[] = [];
  for (const grant of matching) {
    await verifyGovernanceReviewerGrant(grant, { userId: subject.id, bankidId: subject.bankidId }, verification);
    if (!valid.some((candidate) => candidate.artifact_id === grant.artifact_id && candidate.content_hash.value === grant.content_hash.value)) valid.push(grant);
  }
  if (valid.length === 0) throw new GovernanceReviewerGrantRejected('authenticated user has no verified GOVERNANCE_REVIEWER grant');
  if (valid.length !== 1) throw new GovernanceReviewerGrantRejected('authenticated user has ambiguous GOVERNANCE_REVIEWER grants');
  const grant = valid[0];
  return {
    identity_ref: { id: grant.artifact_id, content_hash: { algorithm: 'sha256', digest: grant.content_hash.value } },
    role: 'GOVERNANCE_REVIEWER',
  };
}
