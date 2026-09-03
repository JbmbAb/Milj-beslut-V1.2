import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keypairPaths } from '../../server/security/ceremonyKeypairBootstrap';
import {
  bootstrapGovernanceReviewerDocumentEvidenceAuthority,
  DOCUMENT_EVIDENCE_ADMISSION_SIGNER_FAMILY,
  GOVERNANCE_REVIEWER_ISSUER_FAMILY,
} from '../../scripts/ops/bootstrap-governance-reviewer-document-evidence-authority';

const roots: string[] = [];
function root() { const value = mkdtempSync(join(tmpdir(), 'reviewer-evidence-ceremony-')); roots.push(value); return value; }
function hashes(value: string) { return [GOVERNANCE_REVIEWER_ISSUER_FAMILY, DOCUMENT_EVIDENCE_ADMISSION_SIGNER_FAMILY].flatMap((family) => { const paths = keypairPaths(value, family); return [paths.privatePath, paths.publicPath].map((path) => createHash('sha256').update(readFileSync(path)).digest('hex')); }); }
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true })));

describe('governance reviewer / document evidence authority ceremony', () => {
  it('creates both dedicated families and fails closed on a second execution without changing bytes', () => {
    const secretsRoot = root();
    expect(bootstrapGovernanceReviewerDocumentEvidenceAuthority(secretsRoot).map((item) => item.family)).toEqual([
      GOVERNANCE_REVIEWER_ISSUER_FAMILY,
      DOCUMENT_EVIDENCE_ADMISSION_SIGNER_FAMILY,
    ]);
    const before = hashes(secretsRoot);
    expect(() => bootstrapGovernanceReviewerDocumentEvidenceAuthority(secretsRoot)).toThrow(/ALREADY_PROVISIONED/);
    expect(hashes(secretsRoot)).toEqual(before);
  });

  it('requires an explicit isolated secrets root', () => {
    expect(() => bootstrapGovernanceReviewerDocumentEvidenceAuthority('')).toThrow(/--secrets-root is required/);
  });
});
