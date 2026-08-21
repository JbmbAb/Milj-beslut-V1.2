/**
 * LEGAL-ANSWER-PRODUCT-WIRING-01 -- real end-to-end HTTP proof.
 *
 * Same rationale as LEGAL-RETRIEVAL-SERVING-BOUNDARY-01's proof script: run as a standalone script
 * against the real, already-populated dev DB and real running app, not as a
 * tests/integration/*.test.ts file (that project's globalSetup truncates every table).
 *
 * Proves P1, P2, P3, P4, P5, P6, P8 from the required product-proof matrix against the real
 * /api/legal/answer endpoint. P7 (UI renders returned citations) is proven separately at the
 * component level (tests/unit/LegalSupportView.test.tsx) and P2/P3's UI-reachability half is
 * proven at tests/unit/AppSidebarLegalWiring.test.tsx + AppContentRouter.test.tsx.
 *
 * Usage: npx tsx scripts/db/legal-answer-product-wiring-01.ts
 */
import '../../server/loadEnvFirst';
import supertest from 'supertest';
import { createApp } from '../../server/createApp';
import { prisma } from '../../server/db/prisma';

async function loginAsAdmin(agent: ReturnType<typeof supertest.agent>): Promise<{ token: string; csrfToken: string }> {
  const csrfRes = await agent.get('/api/csrf-token');
  const csrfToken = String(csrfRes.body.csrfToken);
  if (!csrfToken) throw new Error('Failed to acquire CSRF token');

  const res = await agent
    .post('/api/admin/auth/login')
    .set('x-csrf-token', csrfToken)
    .send({
      username: process.env.ADMIN_CONSOLE_USERNAME || 'admin',
      password: process.env.ADMIN_CONSOLE_PASSWORD || 'admin',
    });
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(`Admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: String(res.body.accessToken), csrfToken };
}

async function main() {
  console.log('########## LEGAL-ANSWER-PRODUCT-WIRING-01 ##########\n');
  const app = createApp();
  const request = supertest.agent(app);

  console.log('--- authenticating as admin ---');
  const { token, csrfToken } = await loginAsAdmin(request);
  console.log('token acquired:', token.slice(0, 12) + '...');

  const post = (body: unknown) =>
    request
      .post('/api/legal/answer')
      .set('Authorization', `Bearer ${token}`)
      .set('x-csrf-token', csrfToken)
      .send(body);

  console.log('\n--- P1: authenticated legal UI request -> governed answer ---');
  const p1 = await post({ query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law', top_k: 6 });
  console.log('status:', p1.status, '| contract_version:', p1.body.contract_version, '| mode:', p1.body.mode, '| claims:', p1.body.claims?.length);
  const proof1 = p1.status === 200 && p1.body.ok === true && p1.body.contract_version === 'legal-answer-serving-v1' && p1.body.mode === 'ANSWERED' && p1.body.claims.length > 0;
  console.log('PROOF P1:', proof1);

  console.log('\n--- P2: 0/1 recognized source path -> retrieval stays within requested topK ---');
  const p2 = await post({ query: 'Mark- och miljööverdomstolens dom i mål M 307-24', family: 'court', top_k: 6 });
  console.log('status:', p2.status, '| mode:', p2.body.mode, '| retrieval.results_count:', p2.body.retrieval?.results_count, '| named_source_consistency:', JSON.stringify(p2.body.named_source_consistency));
  const proof2 = p2.status === 200 && (p2.body.retrieval?.results_count ?? 99) <= 6 && p2.body.named_source_consistency === null;
  console.log('PROOF P2 (single/no-source path unaffected, results <= requested topK):', proof2);

  console.log('\n--- P3: 2+ recognized source path -> multisource budget branch actually reached ---');
  const p3 = await post({
    query: 'Vad gäller enligt både miljöprövningsförordningen och miljöbalken för tillståndsprövning av djurhållning?',
    family: 'law',
    top_k: 6,
  });
  console.log('status:', p3.status, '| mode:', p3.body.mode, '| retrieval.results_count:', p3.body.retrieval?.results_count, '| named_source_consistency:', JSON.stringify(p3.body.named_source_consistency));
  const proof3 =
    p3.status === 200 &&
    (p3.body.named_source_consistency?.named_known_source_ids?.length ?? 0) >= 2 &&
    (p3.body.retrieval?.results_count ?? 0) > 6; // single-query path could never exceed the requested topK=6
  console.log('PROOF P3 (2+ named sources recognized AND retrieval exceeded the single-source budget -> multisource branch reached via real HTTP request):', proof3);

  console.log('\n--- P4: named-source inconsistency -> BLOCKS ---');
  const p4 = await post({ query: 'Vilka regler gäller för fiske och fiskevård enligt fiskelagen?', family: 'law', top_k: 6 });
  console.log('status:', p4.status, '| mode:', p4.body.mode, '| named_source_consistency:', JSON.stringify(p4.body.named_source_consistency));
  const proof4 = p4.status === 200 && p4.body.mode === 'NAMED_SOURCE_NOT_AVAILABLE' && p4.body.claims.length === 0;
  console.log('PROOF P4:', proof4);

  console.log('\n--- P5: QUERY_UNDERSPECIFIED -> safe/expected, no retrieval spent ---');
  const p5 = await post({ query: 'Vad gäller?' });
  console.log('status:', p5.status, '| mode:', p5.body.mode, '| retrieval.results_count:', p5.body.retrieval?.results_count);
  const proof5 = p5.status === 200 && p5.body.mode === 'QUERY_UNDERSPECIFIED' && p5.body.retrieval?.results_count === null;
  console.log('PROOF P5:', proof5);

  console.log('\n--- P6: answer citations survive API serialization -> independently re-verified against the live DB ---');
  let proof6 = p1.body.claims.length > 0;
  for (const claim of p1.body.claims as { citations: { fragment_id: string; materialization_id: string; source_provenance_refs: string[] }[] }[]) {
    for (const citation of claim.citations) {
      const row = await prisma.legalCorpusMaterializedChunk.findUnique({
        where: { materializationId_fragmentId: { materializationId: citation.materialization_id, fragmentId: citation.fragment_id } },
      });
      if (!row) proof6 = false;
      if (!citation.source_provenance_refs || citation.source_provenance_refs.length === 0) proof6 = false;
    }
  }
  console.log('PROOF P6 (every citation in the serialized response resolves to a real governed chunk):', proof6);

  console.log('\n--- P8: no legacy legal handler reached ---');
  // Structural: legalAnswer.routes.ts imports nothing from legal.routes.ts, searchLegalCorpusTool,
  // or the /api/gemini router (verified by direct source inspection during this unit's own
  // implementation). Runtime corroboration: the legacy /api/legal/search endpoint has a completely
  // different response contract (no contract_version field at all) -- proving these are genuinely
  // distinct code paths, not aliased to the same handler under two routes.
  const legacy = await request
    .post('/api/legal/search')
    .set('Authorization', `Bearer ${token}`)
    .set('x-csrf-token', csrfToken)
    .send({ query: 'test' });
  console.log('legacy /api/legal/search status:', legacy.status, '| has contract_version field:', 'contract_version' in (legacy.body || {}));
  const proof8 = p1.body.contract_version === 'legal-answer-serving-v1' && !('contract_version' in (legacy.body || {}));
  console.log('PROOF P8 (canonical and legacy endpoints are distinct, non-aliased implementations):', proof8);

  console.log('\n\n========== SUMMARY ==========');
  console.log(JSON.stringify({ proof1, proof2, proof3, proof4, proof5, proof6, proof8 }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
