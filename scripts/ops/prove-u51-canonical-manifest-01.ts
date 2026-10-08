/**
 * prove-u51-canonical-manifest-01 -- thin shell around packages/mps-u51-manifest (contract section 11.2).
 *
 * Run it from a separately pinned, CLEAN controller checkout, never from the subject tree. Exit codes follow
 * scripts/devgov/invariant-packs.mjs: 0 = PASS (FREEZE_ELIGIBLE, not FROZEN), 1 = FAIL (a failure code),
 * 2 = NOT_EXECUTED / could not run.
 *
 *   npx tsx scripts/ops/prove-u51-canonical-manifest-01.ts --subject-repo <path> --commit <rev> --manifest <file> \
 *     --policy <file> --policy-attestation <file> --evidence-dir <dir> --out <file> [--expected-manifest-sha256 <hex>]
 *
 * Every manifest/policy/attestation/evidence/out path must lie OUTSIDE the subject checkout (I13).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProverCli } from '../../packages/mps-u51-manifest/src/runner/cli';
import { productionCliDeps } from '../../packages/mps-u51-manifest/src/runner/productionWiring';

const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outcome = runProverCli(process.argv.slice(2), productionCliDeps(controllerRoot));
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exitCode = outcome.exit_code;
