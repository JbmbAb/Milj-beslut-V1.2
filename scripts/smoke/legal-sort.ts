/**
 * scripts/smoke/legal-sort.ts
 *
 * Smoketest för sortering och relevansranking av juridikdata.
 *  1. Deterministiskt test: samma query kör två gånger, resultaten ska
 *     vara identiska (stabil sortering via tie-breaker på id).
 *  2. Relevansrelevans-test: sort=relevance med olika söktermer ska
 *     producera olika top-träffar (om det finns data).
 *
 * BASE_URL kan sättas för att köra mot server.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8787';

interface Item {
  id: string;
  title: string;
  score?: number;
}

async function fetchJudgments(params: Record<string, string>): Promise<Item[]> {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}/api/legal/judgments?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} från ${url}`);
  }
  const body: any = await res.json();
  return (body?.items ?? []).map((it: any) => ({
    id: it.id,
    title: it.title,
    score: it.score,
  }));
}

async function main(): Promise<void> {
  console.log(`Legal-sort smoketest mot ${BASE_URL}`);
  console.log('─'.repeat(80));
  let failures = 0;

  // Test 1: Deterministisk sortering
  try {
    const a = await fetchJudgments({ sort: 'pubDate', order: 'desc', pageSize: '20' });
    const b = await fetchJudgments({ sort: 'pubDate', order: 'desc', pageSize: '20' });
    const idsA = a.map((i) => i.id).join(',');
    const idsB = b.map((i) => i.id).join(',');
    if (idsA === idsB && a.length > 0) {
      console.log(`[OK] Deterministisk sortering: ${a.length} poster, identisk ordning`);
    } else if (a.length === 0) {
      console.log('[WARN] Deterministisk sortering: 0 poster — kan inte verifiera ordning');
    } else {
      console.log(`[FAIL] Deterministisk sortering: ordning skiljer sig!`);
      console.log(`  A: ${idsA}`);
      console.log(`  B: ${idsB}`);
      failures++;
    }
  } catch (err) {
    console.log(`[FAIL] Deterministisk sortering: ${err instanceof Error ? err.message : err}`);
    failures++;
  }

  // Test 2: Relevans-ranking med olika söktermer
  try {
    const term1 = await fetchJudgments({ sort: 'relevance', q: 'miljöbalken', pageSize: '5' });
    const term2 = await fetchJudgments({ sort: 'relevance', q: 'avfall', pageSize: '5' });
    if (term1.length === 0 && term2.length === 0) {
      console.log('[WARN] Relevans-ranking: 0 poster i båda — kan inte verifiera');
    } else {
      const top1 = term1[0]?.id ?? '';
      const top2 = term2[0]?.id ?? '';
      const differs = top1 !== top2;
      console.log(
        `[${differs ? 'OK' : 'WARN'}] Relevans-ranking: top för 'miljöbalken'=${top1.slice(0, 8)}, top för 'avfall'=${top2.slice(0, 8)} (${differs ? 'olika' : 'samma — kanske för lite data'})`,
      );
      // Scores ska vara numeriska och sorterade descending.
      const firstScore = term1[0]?.score;
      const sortedAsc = term1.every(
        (item, idx) => idx === 0 || (term1[idx - 1].score ?? 0) >= (item.score ?? 0),
      );
      if (term1.length > 1 && !sortedAsc) {
        console.log('[FAIL] Relevans-scores inte sorterade descending!');
        failures++;
      } else if (term1.length > 0 && typeof firstScore !== 'number') {
        console.log('[WARN] Ingen score på första träffen — kontrollera legalRelevanceService');
      }
    }
  } catch (err) {
    console.log(`[FAIL] Relevans-ranking: ${err instanceof Error ? err.message : err}`);
    failures++;
  }

  console.log('─'.repeat(80));
  console.log(failures > 0 ? `${failures} test(er) fallerade.` : 'Alla test passerade.');
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Smoke-fel:', err);
  process.exit(1);
});
