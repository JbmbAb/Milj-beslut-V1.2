/**
 * NON_REPRODUCIBLE fixture program (BOOTSTRAP section 6, plan T11). Run with tsx:
 *
 *   node node_modules/tsx/dist/cli.mjs packages/mps-pattern-proof/tests/fixtures/regenerate-proof-package.ts
 *
 * It prints ONE ProofPackage as JSON on stdout. The package is schema-valid and carries a complete,
 * apparently closed InputManifest -- yet its `provenInvariants` also depend on `PPE_FIXTURE_MODE`, an
 * input the manifest never declares. Replaying the identical declared manifest with mode A and then
 * mode B therefore yields two different packages: semantic input-closure failure, not schema failure.
 * With the same mode twice the output is byte-identical (the control case).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProofPackage } from '../../src/artifacts';
import { validProofPackage } from './artifacts';

export const FIXTURE_MODE_ENV = 'PPE_FIXTURE_MODE';

/** The declared manifest is identical for every mode; only the (undeclared) mode leaks into the result. */
export function buildFixtureProofPackage(mode: string): ProofPackage {
  const base = validProofPackage();
  return {
    ...base,
    provenInvariants: [...base.provenInvariants, `fixture-mode:${mode}`],
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const mode = process.env[FIXTURE_MODE_ENV] ?? 'A';
  process.stdout.write(`${JSON.stringify(buildFixtureProofPackage(mode))}\n`);
}
