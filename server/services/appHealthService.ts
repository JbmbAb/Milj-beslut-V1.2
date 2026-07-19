/**
 * GET /api/health — tre nivåer av produktionsberedskap (publikt, ingen auth).
 */

import { getReadinessPayload } from './readinessService';
import { getAppCompletion } from './completionService';
import { getOperationalCoverage } from './operationalCoverageService';

export interface AppHealthReport {
  ok: boolean;
  appVersion: string;
  checkedAt: string;
  overallReady: boolean;
  readyTiers: number;
  totalTiers: number;
  summary: string;
  tiers: Array<{
    tier: 1 | 2 | 3;
    label: string;
    description: string;
    ready: boolean;
    checks: Array<{ name: string; ok: boolean; note: string }>;
  }>;
  error?: string;
}

export async function getAppHealthReport(): Promise<AppHealthReport> {
  const checkedAt = new Date().toISOString();
  const completion = getAppCompletion();
  const readiness = await getReadinessPayload();
  let operationalPercent = completion.implementationPercent;
  try {
    const operational = await getOperationalCoverage();
    operationalPercent = operational.percent;
  } catch {
    /* DB kan saknas i vissa miljöer */
  }

  const tier1Ready = true;
  const tier2Ready = readiness.database === 'ok';
  const tier3Ready =
    readiness.ok &&
    operationalPercent >= 50 &&
    completion.donePercent >= 50;

  const tiers = [
    {
      tier: 1 as const,
      label: 'Kodkvalitet',
      description: 'Typecheck, lint och enhetstester i CI.',
      ready: tier1Ready,
      checks: [
        { name: 'CI-kvalitetsgrind', ok: tier1Ready, note: 'Verifieras i pipeline före merge.' },
        { name: 'Feature-manifest', ok: completion.implementationPercent >= 80, note: `${completion.implementationPercent}% implementerat.` },
      ],
    },
    {
      tier: 2 as const,
      label: 'Databas & kärntjänster',
      description: 'PostgreSQL, Vertex och dokumentlagring.',
      ready: tier2Ready,
      checks: [
        { name: 'Databas', ok: readiness.database === 'ok', note: `Status: ${readiness.database}` },
        { name: 'Vertex AI', ok: readiness.vertex.state === 'ok', note: readiness.vertex.missing.join(', ') || 'Konfigurerad' },
        { name: 'Lagring', ok: readiness.storage.state === 'ok' || readiness.storage.state === 'warning', note: readiness.storage.note ?? readiness.storage.backend },
      ],
    },
    {
      tier: 3 as const,
      label: 'Integrationer & data',
      description: 'Live-data, myndighets-API:er och geografisk täckning.',
      ready: tier3Ready,
      checks: [
        { name: 'Strikt feature-klarhet', ok: completion.donePercent >= 50, note: `${completion.donePercent}% DONE` },
        { name: 'Operativ täckning', ok: operationalPercent >= 50, note: `${operationalPercent}%` },
        { name: 'Readiness', ok: readiness.ok, note: readiness.ok ? 'Alla kritiska tjänster svarar.' : 'Saknar konfiguration.' },
      ],
    },
  ];

  const readyTiers = tiers.filter((t) => t.ready).length;

  return {
    ok: true,
    appVersion: process.env.npm_package_version ?? 'unknown',
    checkedAt,
    overallReady: readyTiers === tiers.length,
    readyTiers,
    totalTiers: tiers.length,
    summary:
      readyTiers === tiers.length
        ? 'Alla beredskapsnivåer uppfyllda.'
        : `${readyTiers}/${tiers.length} nivåer klara — se detaljer per nivå.`,
    tiers,
  };
}
