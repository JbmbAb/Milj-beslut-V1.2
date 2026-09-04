import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keypairPaths } from '../../server/security/ceremonyKeypairBootstrap';
import {
  bootstrapDocumentReviewAuthority,
  DOCUMENT_FACT_REVIEW_SIGNER_FAMILY,
  DOCUMENT_PROPERTY_REVIEW_SIGNER_FAMILY,
} from '../../scripts/ops/bootstrap-document-review-authority';

const roots: string[] = [];
function root() { const value = mkdtempSync(join(tmpdir(), 'document-review-ceremony-')); roots.push(value); return value; }
function hashes(value: string) {
  return [DOCUMENT_FACT_REVIEW_SIGNER_FAMILY, DOCUMENT_PROPERTY_REVIEW_SIGNER_FAMILY].flatMap((family) => {
    const paths = keypairPaths(value, family);
    return [paths.privatePath, paths.publicPath].map((path) => createHash('sha256').update(readFileSync(path)).digest('hex'));
  });
}
afterEach(() => roots.splice(0).forEach((value) => rmSync(value, { recursive: true, force: true })));

describe('document review authority ceremony', () => {
  it('creates both review signer families atomically and preserves bytes when the second run is denied', () => {
    const secretsRoot = root();
    expect(bootstrapDocumentReviewAuthority(secretsRoot).map((item) => item.family)).toEqual([
      DOCUMENT_FACT_REVIEW_SIGNER_FAMILY,
      DOCUMENT_PROPERTY_REVIEW_SIGNER_FAMILY,
    ]);
    const before = hashes(secretsRoot);
    expect(() => bootstrapDocumentReviewAuthority(secretsRoot)).toThrow(/ALREADY_PROVISIONED/);
    expect(hashes(secretsRoot)).toEqual(before);
  });

  it('requires an explicit secrets root', () => {
    expect(() => bootstrapDocumentReviewAuthority('')).toThrow(/--secrets-root is required/);
  });
});
