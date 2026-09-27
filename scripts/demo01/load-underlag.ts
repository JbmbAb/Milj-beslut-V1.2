// DEMO-01: create a demo case from the user's underlag via the declared seed loader
// (server/modules/c-anmalan-demo/seedUnderlag.ts; DEMO_UNDERLAG_DIR / DEMO_UNDERLAG_MAPPING from
// env) and build its proposal. Approval is left to the user in the demo view.
//
// Usage (cwd = worktree root, local DB up; DEMO_UNDERLAG_DIR is required, no default):
//   DEMO_UNDERLAG_DIR=<underlag dir> node --import tsx scripts/demo01/load-underlag.ts --user <userId> --org <organisationId>
//        --role ADMIN|CONSULTANT --project <projectId> [--approve-all-for-writer-test]
import '../../server/loadEnvFirst';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing --${name}`);
  return process.argv[i + 1];
};

(async () => {
  const { seedFromUnderlag } = await import('../../server/modules/c-anmalan-demo/seedUnderlag');
  const { createCase, proposeCase, approveCase } = await import('../../server/modules/c-anmalan-demo/demoService');
  const { dir, input, underlag } = seedFromUnderlag();
  const user = { id: arg('user'), organisationId: arg('org'), role: arg('role') as 'ADMIN' | 'CONSULTANT', bankidId: 'demo01-seed-loader' };
  const created = await createCase(user, arg('project'), input, underlag);
  if (created.ok === false) throw new Error(`create failed: ${created.error}`);
  const proposed = await proposeCase(user, created.value.id);
  if (proposed.ok === false) throw new Error(`proposal failed: ${proposed.error}`);
  const rows = proposed.value.proposal!.rows;
  let frozenSha256: string | undefined;
  // Writer test only: the real approval is the user's own, row by row, in the demo view.
  if (process.argv.includes('--approve-all-for-writer-test')) {
    const approved = await approveCase(user, created.value.id, rows.map((r) => ({ rowId: r.id, action: 'accept' as const })));
    if (approved.ok === false) throw new Error(`approve failed: ${approved.error}`);
    frozenSha256 = approved.value.approval?.frozenSha256;
  }
  console.log(JSON.stringify({
    underlagDir: dir,
    caseId: created.value.id,
    fictional: underlag.fictional,
    rows: rows.length,
    userRowsWithFileSource: rows.filter((r) => r.provenance.kind === 'user_input' && r.provenance.sources?.length).length,
    frozenSha256,
    open: `#/demo/c-anmalan?case=${created.value.id}`,
  }, null, 2));
  process.exit(0);
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
