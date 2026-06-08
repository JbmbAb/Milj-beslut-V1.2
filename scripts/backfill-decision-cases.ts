/**
 * Backfills the decision fact layer from DocumentRecord + RequirementCase.
 *
 * Safe by default:
 *   npm run backfill:decision-cases -- --dry-run
 *
 * Write mode:
 *   npm run backfill:decision-cases -- --write --limit 500
 */

import { loadEnvFile } from '../server/loadEnv';
import { backfillDecisionFacts, type DecisionEtlOptions } from '../server/modules/analytics/public';

function parseArgs(argv: string[]): DecisionEtlOptions {
  const options: DecisionEtlOptions = {
    write: argv.includes('--write'),
    profilesOnly: argv.includes('--profiles-only'),
    skipProfiles: argv.includes('--skip-profiles'),
    limit: 500,
  };

  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    const value = argv[index + 1];

    if (key === '--limit' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.trunc(parsed);
      }
      index++;
      continue;
    }

    if (key === '--municipality' && value) {
      options.municipality = value.trim();
      index++;
    }
  }

  return options;
}

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const options = parseArgs(process.argv.slice(2));
  const result = await backfillDecisionFacts(options);

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
