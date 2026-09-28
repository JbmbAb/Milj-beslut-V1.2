// DEMO-01 warm-up: runs the same read-only queries a proposal runs (layer facts, MPF citation,
// K-24 requirements) so the first proposal in the demo is not slowed by a cold database cache.
// Creates and changes nothing. The property and codes come from a demo case (--case <id>) or,
// without --case, from the user's underlag (DEMO_UNDERLAG_DIR); never from literals here.
//
// Usage (cwd = worktree root): node --import tsx scripts/demo01/warm.ts [--case <id>]
import '../../server/loadEnvFirst';

const argValue = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

(async () => {
  const started = Date.now();
  const { loadCase } = await import('../../server/modules/c-anmalan-demo/caseStore');
  const { readLayerFacts } = await import('../../server/modules/c-anmalan-demo/localization');
  const { citeMpfCodes } = await import('../../server/modules/c-anmalan-demo/legalCitation');
  const { loadRequirements } = await import('../../server/modules/c-anmalan-demo/requirementsSource');

  let designation: string;
  let codes: string[];
  const caseId = argValue('case');
  if (caseId) {
    const record = loadCase(caseId);
    if (!record) throw new Error(`demoärendet finns inte: ${caseId}`);
    designation = record.input.propertyDesignation;
    codes = record.input.verksamhetskoder;
  } else {
    const { seedFromUnderlag } = await import('../../server/modules/c-anmalan-demo/seedUnderlag');
    const { input } = seedFromUnderlag();
    designation = input.propertyDesignation;
    codes = input.verksamhetskoder;
  }

  const t1 = Date.now();
  const facts = await readLayerFacts(designation);
  const t2 = Date.now();
  const citations = await citeMpfCodes(codes);
  const t3 = Date.now();
  const req = loadRequirements();
  const t4 = Date.now();
  console.log(
    JSON.stringify({
      warmed: true,
      propertyFound: facts.propertyFound,
      layersWithBatch: Object.keys(facts.batches).length,
      codesCited: citations.filter((c) => c.found).map((c) => c.code),
      requirements: req.status.state,
      ms: { layers: t2 - t1, mpf: t3 - t2, requirements: t4 - t3, total: t4 - started },
    }),
  );
  process.exit(0);
})().catch((e) => {
  console.error(`värmning misslyckades: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
