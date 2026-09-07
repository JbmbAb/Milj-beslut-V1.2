import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import { mintGovernanceReviewerGrant, resolveGovernanceReviewerActor, verifyGovernanceReviewerGrant } from '../../server/services/governanceReviewerGrantService';
import { getGovernanceReviewerGrantVerifier } from '../../server/security/governanceReviewerGrantVerifier';
import type { AuthUser } from '../../server/security/types';

const originals = new Map<string, string | undefined>();
const roots: string[] = [];
function set(name: string, value: string | undefined) { if (!originals.has(name)) originals.set(name, process.env[name]); if (value === undefined) delete process.env[name]; else process.env[name] = value; }
function root() { const value = mkdtempSync(join(tmpdir(), 'governance-reviewer-grants-')); roots.push(value); return value; }
function subject(id: string, bankidId: string, identityEnvironment = 'TEST') { return { id, bankidId, identityEnvironment }; }
function repo(entries: readonly ReturnType<typeof subject>[]) { return { findById: async (id: string) => entries.find((entry) => entry.id === id) ?? null }; }
function auth(id: string, bankidId: string, role: AuthUser['role'] = 'CONSULTANT'): AuthUser { return { id, bankidId, organisationId: 'org-1', role }; }

afterEach(() => {
  roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true }));
  for (const [name, value] of originals) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  originals.clear();
});

describe('GOVERNANCE-REVIEWER-AUTHORITY-AND-DOCUMENT-EVIDENCE-SIGNER-PROVISIONING-01 reviewer grants', () => {
  function configureIssuer() {
    const pair = LocalPemSigningKeyProvider.generate('ed25519:governance-reviewer-role-issuer-v1');
    set('GOVERNANCE_REVIEWER_ISSUER_KEY_ID', pair.provider.keyId);
    set('GOVERNANCE_REVIEWER_ISSUER_PRIVATE_KEY_PEM', pair.privateKey);
    set('GOVERNANCE_REVIEWER_ISSUER_PUBLIC_KEY_PEM', pair.publicKey);
    set('GOVERNANCE_REVIEWER_GRANT_CAS_ROOT', root());
    return pair;
  }

  it('resolves a signed GOVERNANCE_REVIEWER ActorReference only for the bound authenticated user', async () => {
    const pair = configureIssuer();
    const alice = subject('user-alice', '199001011234');
    const grant = await mintGovernanceReviewerGrant({ subjectUserId: alice.id, issuerRef: { artifact_id: 'issuer-1', artifact_type: 'governance_reviewer_grant_issuer' }, issuedAt: '2026-08-26T00:00:00.000Z' }, { subjects: repo([alice]) });
    set('GOVERNANCE_REVIEWER_ISSUER_PRIVATE_KEY_PEM', undefined);
    await expect(verifyGovernanceReviewerGrant(grant, { userId: alice.id, bankidId: alice.bankidId }, getGovernanceReviewerGrantVerifier())).resolves.toBeUndefined();
    await expect(resolveGovernanceReviewerActor(auth(alice.id, alice.bankidId), { subjects: repo([alice]), verification: getGovernanceReviewerGrantVerifier() })).resolves.toEqual({
      identity_ref: { id: grant.artifact_id, content_hash: { algorithm: 'sha256', digest: grant.content_hash.value } },
      role: 'GOVERNANCE_REVIEWER',
    });
    expect(pair.provider.keyId).toBe(grant.payload.issuer_key_id);
  });

  it('denies ADMIN-only, ungranted, forged and wrong-user reviewer claims', async () => {
    configureIssuer();
    const alice = subject('user-alice', '199001011234');
    const bob = subject('user-bob', '199101011234');
    await expect(resolveGovernanceReviewerActor(auth(alice.id, alice.bankidId, 'ADMIN'), { subjects: repo([alice, bob]) })).rejects.toThrow(/no verified GOVERNANCE_REVIEWER grant/);
    await mintGovernanceReviewerGrant({ subjectUserId: alice.id, issuerRef: { artifact_id: 'issuer-1', artifact_type: 'governance_reviewer_grant_issuer' }, issuedAt: '2026-08-26T00:00:00.000Z' }, { subjects: repo([alice, bob]) });
    await expect(resolveGovernanceReviewerActor(auth(bob.id, bob.bankidId), { subjects: repo([alice, bob]) })).rejects.toThrow(/no verified GOVERNANCE_REVIEWER grant/);
    await expect(resolveGovernanceReviewerActor(auth(alice.id, bob.bankidId), { subjects: repo([alice, bob]) })).rejects.toThrow(/no eligible canonical BankID identity/);
  });

  it('represents two distinct granted reviewers and rejects synthetic BankID identities', async () => {
    configureIssuer();
    const alice = subject('user-alice', '199001011234');
    const bob = subject('user-bob', '199101011234');
    const store = repo([alice, bob]);
    await mintGovernanceReviewerGrant({ subjectUserId: alice.id, issuerRef: { artifact_id: 'issuer-1', artifact_type: 'governance_reviewer_grant_issuer' }, issuedAt: '2026-08-26T00:00:00.000Z' }, { subjects: store });
    await mintGovernanceReviewerGrant({ subjectUserId: bob.id, issuerRef: { artifact_id: 'issuer-1', artifact_type: 'governance_reviewer_grant_issuer' }, issuedAt: '2026-08-26T00:00:01.000Z' }, { subjects: store });
    const [aliceActor, bobActor] = await Promise.all([
      resolveGovernanceReviewerActor(auth(alice.id, alice.bankidId), { subjects: store }),
      resolveGovernanceReviewerActor(auth(bob.id, bob.bankidId), { subjects: store }),
    ]);
    expect(aliceActor.identity_ref.id).not.toBe(bobActor.identity_ref.id);
    const mock = subject('mock-user', 'mock-bankid-user', 'MOCK');
    await expect(mintGovernanceReviewerGrant({ subjectUserId: mock.id, issuerRef: { artifact_id: 'issuer-1', artifact_type: 'governance_reviewer_grant_issuer' } }, { subjects: repo([mock]) })).rejects.toThrow(/not a real authenticated BankID identity/);
  });
});
