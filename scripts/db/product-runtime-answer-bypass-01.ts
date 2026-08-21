/**
 * PRODUCT-RUNTIME-ANSWER-BYPASS-01 -- real end-to-end proof, post-implementation.
 *
 * Same rationale as the prior units' proof scripts: real server (createApp()), real dev DB, real
 * admin auth + CSRF, against the actual running app -- not a mocked reachability claim.
 *
 * Required proof matrix (owner-specified):
 *   LegalSupportView -> /api/legal/answer -> canonical governed chain    PASS
 *   global ChatBot freeform answer                                      UNREACHABLE
 *   DetailModal permit freeform answer                                  UNREACHABLE
 *   /api/gemini askGeneralAssistant bare/fallback answer                FAIL CLOSED
 *   /api/gemini chatWithPermit freeform answer                          FAIL CLOSED
 *   unauthenticated loopback carve-out                                  ABSENT
 *   legacy /api/legal/search UI caller                                  0
 *
 * "UNREACHABLE" for ChatBot/DetailModal is proven at the component level
 * (tests/components/chatBot.test.tsx, tests/components/detailModal.test.tsx -- real render, real
 * click, asserts zero network calls / no freeform input exists) since that is a UI-reachability
 * claim, not an HTTP one; this script proves everything that IS an HTTP-observable claim, plus a
 * fresh, post-implementation grep re-trace of every caller (never inferred from removal alone).
 *
 * Usage: npx tsx scripts/db/product-runtime-answer-bypass-01.ts
 */
import '../../server/loadEnvFirst';
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
    return []; // grep exits 1 when nothing matches
  }
}

async function main() {
  console.log('########## PRODUCT-RUNTIME-ANSWER-BYPASS-01 ##########\n');
  const app = createApp();
  const request = supertest.agent(app);

  console.log('--- authenticating as admin ---');
  const { token, csrfToken } = await loginAsAdmin(request);
  console.log('token acquired:', token.slice(0, 12) + '...');

  console.log('\n--- PROOF: LegalSupportView -> /api/legal/answer -> canonical governed chain (regression check) ---');
  const answer = await request
    .post('/api/legal/answer')
    .set('Authorization', `Bearer ${token}`)
    .set('x-csrf-token', csrfToken)
    .send({ query: 'Vad är miljöbalkens mål och tillämpningsområde?', family: 'law', top_k: 6 });
  console.log('status:', answer.status, '| contract_version:', answer.body.contract_version, '| mode:', answer.body.mode);
  const proofCanonical = answer.status === 200 && answer.body.contract_version === 'legal-answer-serving-v1';
  console.log('PROOF (canonical chain still reachable and unaffected):', proofCanonical);

  console.log('\n--- PROOF: /api/gemini askGeneralAssistant -> FAIL CLOSED (authenticated) ---');
  const ask = await request
    .post('/api/gemini')
    .set('Authorization', `Bearer ${token}`)
    .set('x-csrf-token', csrfToken)
    .send({ method: 'askGeneralAssistant', payload: { message: 'Vad säger miljöbalken om avfall?', history: [] } });
  console.log('status:', ask.status, '| body:', JSON.stringify(ask.body));
  const proofAskFailClosed = ask.status === 410 && ask.body.ok === false;
  console.log('PROOF (askGeneralAssistant fails closed server-side, authenticated):', proofAskFailClosed);

  console.log('\n--- PROOF: /api/gemini chatWithPermit -> FAIL CLOSED (authenticated) ---');
  const chat = await request
    .post('/api/gemini')
    .set('Authorization', `Bearer ${token}`)
    .set('x-csrf-token', csrfToken)
    .send({ method: 'chatWithPermit', payload: { permit: { property_id: 'X', municipality: 'Y', full_text: 'Z' }, message: 'Vad gäller?', history: [] } });
  console.log('status:', chat.status, '| body:', JSON.stringify(chat.body));
  const proofChatFailClosed = chat.status === 410 && chat.body.ok === false;
  console.log('PROOF (chatWithPermit fails closed server-side, authenticated):', proofChatFailClosed);

  console.log('\n--- PROOF: unauthenticated loopback carve-out is ABSENT ---');
  // supertest requests against an in-process app are themselves loopback-origin -- exactly the
  // condition the old carve-out matched on. Isolate the AUTH question specifically from CSRF (a
  // separate, earlier middleware layer) by using a fresh agent that still presents a valid CSRF
  // token but deliberately omits Authorization -- exactly what the old carve-out was designed to
  // let through for method:'askGeneralAssistant'.
  const noAuthAgent = supertest.agent(app);
  const noAuthCsrf = String((await noAuthAgent.get('/api/csrf-token')).body.csrfToken);
  const unauth = await noAuthAgent
    .post('/api/gemini')
    .set('x-csrf-token', noAuthCsrf)
    .send({ method: 'askGeneralAssistant', payload: { message: 'test' } });
  console.log('status (no Authorization header, valid CSRF, loopback origin, method=askGeneralAssistant):', unauth.status, '| body:', JSON.stringify(unauth.body));
  const proofNoCarveOut = unauth.status === 401;
  console.log('PROOF (no anonymous-loopback bypass remains -- requireAuth actually ran and rejected):', proofNoCarveOut);

  console.log('\n--- PROOF: legacy /api/legal/search UI caller count (fresh grep, not inferred from removal) ---');
  // A bare substring grep for the URL also matches comments that merely MENTION the legacy route
  // (e.g. "never calls /api/legal/search") -- verified live, this happened during this unit's own
  // proof-script development. Grep for the actual CALL shape (quoted as a callApi/fetch argument)
  // instead, then confirm by eye which files are real callers vs. prose.
  const legacyCallers = grep("'/api/legal/search'", 'components');
  console.log('files that actually CALL \'/api/legal/search\' (not just mention it) under components/:', legacyCallers);
  const mvpLibrarianImporters = grep('MvpLibrarianView', '.').filter((f) => !f.includes('components/mvp/MvpLibrarianView.tsx') && !f.includes('.claude/worktrees'));
  console.log('files importing MvpLibrarianView (excluding itself):', mvpLibrarianImporters);
  const proofLegacyUnreachable = mvpLibrarianImporters.length === 0;
  console.log('PROOF (MvpLibrarianView, the only /api/legal/search UI caller, has zero importers):', proofLegacyUnreachable);

  console.log('\n--- PROOF: fresh grep re-trace of askGeneralAssistant / chatWithPermit callers ---');
  const askCallers = grep('askGeneralAssistant', '.').filter((f) => !f.includes('.claude/worktrees') && !f.includes('node_modules'));
  const chatCallers = grep('chatWithPermit', '.').filter((f) => !f.includes('.claude/worktrees') && !f.includes('node_modules'));
  console.log('files referencing askGeneralAssistant:', askCallers);
  console.log('files referencing chatWithPermit:', chatCallers);
  const uiComponentAskCallers = askCallers.filter((f) => f.includes('components/') || f.includes('components\\'));
  const uiComponentChatCallers = chatCallers.filter((f) => f.includes('components/') || f.includes('components\\'));
  console.log('UI component files still CALLING (not just commenting on) askGeneralAssistant/chatWithPermit:', [...uiComponentAskCallers, ...uiComponentChatCallers]);

  console.log('\n\n========== SUMMARY ==========');
  console.log(JSON.stringify({
    proofCanonical,
    proofAskFailClosed,
    proofChatFailClosed,
    proofNoCarveOut,
    proofLegacyUnreachable,
  }, null, 2));

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('FATAL:', error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
