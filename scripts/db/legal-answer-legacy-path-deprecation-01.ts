/**
 * LEGAL-ANSWER-LEGACY-PATH-DEPRECATION-01 -- real end-to-end proof.
 *
 * Scope, exactly as approved: MvpLibrarianView.tsx, POST /api/legal/search,
 * searchLegalCorpusHandler, searchLegalCorpusTool, the old legal_corpus_chunks path.
 *
 * Outcome: MvpLibrarianView.tsx (the fully orphaned UI call site -- zero importers, zero internal
 * dependents) was removed. POST /api/legal/search, searchLegalCorpusHandler, and
 * searchLegalCorpusTool were NOT removed -- re-verification found real, non-UI internal
 * dependents (two integration test suites covering auth/validation/rate-limiting/shadow-
 * validation reranker metrics, plus a staging smoke test tied to a separate reranker-quality
 * monitoring initiative). Per instruction, this stops short of forcing removal there and reports
 * the finding instead -- see the PROVEN doc for the full list.
 *
 * Usage: npx tsx scripts/db/legal-answer-legacy-path-deprecation-01.ts
 */
import '../../server/loadEnvFirst';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
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

function grep(pattern: string, path: string): string[] {
  try {
    const out = execSync(
      `grep -rln "${pattern}" "${path}" --include="*.tsx" --include="*.ts" ` +
        `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.claude`,
      { cwd: process.cwd(), encoding: 'utf-8' },
    );
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  console.log('########## LEGAL-ANSWER-LEGACY-PATH-DEPRECATION-01 ##########\n');

  console.log('--- PROOF: MvpLibrarianView.tsx removed, zero remaining references ---');
  const fileExists = fs.existsSync('components/mvp/MvpLibrarianView.tsx');
  // Excludes this unit's own proof scripts, which legitimately mention the removed component's
  // name as a string (in comments and grep patterns) -- not a real import/usage. Verified by eye.
  const remainingRefs = grep('MvpLibrarianView', '.').filter((f) => !f.includes('legal-answer-legacy-path-deprecation-01') && !f.includes('product-runtime-answer-bypass-01'));
  console.log('file still exists:', fileExists, '| remaining real references:', remainingRefs);
  const proofMvpGone = !fileExists && remainingRefs.length === 0;
  console.log('PROOF (MvpLibrarianView fully removed, zero live importers):', proofMvpGone);

  console.log('\n--- PROOF: /api/legal/search live UI callers ---');
  const legacyUiCallers = grep("'/api/legal/search'", 'components');
  console.log('files under components/ that CALL \'/api/legal/search\':', legacyUiCallers);
  const proofNoUiCallers = legacyUiCallers.length === 0;
  console.log('PROOF (zero live UI callers of the legacy search route):', proofNoUiCallers);
  console.log('=> legacy search handler reachable from product UI: ' + (proofNoUiCallers ? 'NO' : 'YES'));

  console.log('\n--- authenticating as admin (for live HTTP proofs) ---');
  const app = createApp();
  const request = supertest.agent(app);
  const { token, csrfToken } = await loginAsAdmin(request);
  console.log('token acquired:', token.slice(0, 12) + '...');

  console.log('\n--- PROOF: canonical LegalSupportView -> /api/legal/answer -> retrieval + citations unaffected ---');
  const answer = await request
    .post('/api/legal/answer')
    .set('Authorization', `Bearer ${token}`)
    .set('x-csrf-token', csrfToken)
    .send({ query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law', top_k: 6 });
  console.log('status:', answer.status, '| contract_version:', answer.body.contract_version, '| mode:', answer.body.mode, '| claims:', answer.body.claims?.length, '| retrieval.results_count:', answer.body.retrieval?.results_count);
  const proofCanonical = answer.status === 200 && answer.body.contract_version === 'legal-answer-serving-v1' && answer.body.mode === 'ANSWERED';
  let proofCitations = (answer.body.claims?.length ?? 0) > 0;
  for (const claim of answer.body.claims ?? []) {
    for (const citation of claim.citations ?? []) {
      const row = await prisma.legalCorpusMaterializedChunk.findUnique({
        where: { materializationId_fragmentId: { materializationId: citation.materialization_id, fragmentId: citation.fragment_id } },
      });
      if (!row) proofCitations = false;
      if (!citation.source_provenance_refs?.length) proofCitations = false;
    }
  }
  console.log('PROOF (canonical retrieval unaffected):', proofCanonical);
  console.log('PROOF (canonical citations unaffected, independently re-verified):', proofCitations);

  console.log('\n\n========== SUMMARY ==========');
  console.log(JSON.stringify({
    proofMvpGone,
    proofNoUiCallers,
    legacySearchHandlerReachableFromUI: !proofNoUiCallers,
    proofCanonical,
    proofCitations,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
