/**
 * Backfills DecisionCase rows from DocumentRecord metadata.
 *
 * Safe by default:
 *   npm run backfill:decision-cases -- --dry-run
 *
 * Write mode:
 *   npm run backfill:decision-cases -- --write --limit 500
 *
 * Optional:
 *   --profiles-only       Recompute MunicipalityDecisionProfile without touching DecisionCase.
 *   --skip-profiles       Do not recompute municipality profiles after DecisionCase backfill.
 *   --municipality "Nacka"
 *   --limit 100
 */

import crypto from 'node:crypto';
import { loadEnvFile } from '../server/loadEnv';

type Args = {
  write: boolean;
  dryRun: boolean;
  profilesOnly: boolean;
  skipProfiles: boolean;
  municipality?: string;
  limit: number;
};

type RequirementCaseProjection = {
  id: string;
  caseKey: string;
  municipality: string | null;
  diarienummer: string | null;
  documentDate: Date | null;
  documentType: string | null;
};

type DocumentProjection = {
  id: string;
  organisationId: string;
  entryId: string;
  receivedTime: Date | null;
  subject: string;
  originalName: string;
  diskName: string;
  fileSha256: string | null;
  decisionType: string | null;
  municipality: string | null;
  municipalityNormalized: string | null;
  wasteType: string | null;
  legalStatus: string | null;
  activityCode: string | null;
  requirementCase: RequirementCaseProjection | null;
};

type DecisionCaseInput = {
  externalCaseKey: string;
  municipality: string;
  activityType: string | null;
  ewcCodes: string[];
  receivedDate: Date | null;
  decisionDate: Date | null;
  outcome: string | null;
  hasCompletionRequest: boolean;
  hasInjunction: boolean;
  hasApproval: boolean;
  dataSource: 'BACKFILL';
  sourceDocumentId: string;
  appRequirementCaseId: string | null;
};

type BackfillStats = {
  scanned: number;
  skippedMissingMunicipality: number;
  skippedExternalKeyCollision: number;
  created: number;
  updated: number;
  unchangedDryRun: number;
  profilesUpdated: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    write: argv.includes('--write'),
    dryRun: !argv.includes('--write'),
    profilesOnly: argv.includes('--profiles-only'),
    skipProfiles: argv.includes('--skip-profiles'),
    limit: 500,
  };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--limit' && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) args.limit = Math.trunc(parsed);
      i++;
    }
    if (key === '--municipality' && value) {
      args.municipality = value.trim();
      i++;
    }
  }

  return args;
}

function cleanText(value: string | null | undefined): string {
  return String(value || '').trim();
}

function normalizeMunicipality(doc: DocumentProjection): string | null {
  const value =
    cleanText(doc.municipalityNormalized) ||
    cleanText(doc.municipality) ||
    cleanText(doc.requirementCase?.municipality);
  if (!value) return null;
  return value.replace(/\s+kommun$/i, '').trim();
}

function keyPart(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9_.:-]+/g, '')
    .slice(0, 120);
}

function buildExternalCaseKey(doc: DocumentProjection, municipality: string): string {
  const diarienummer = keyPart(cleanText(doc.requirementCase?.diarienummer));
  if (diarienummer) return `BACKFILL:DIARIE:${keyPart(municipality)}:${diarienummer}`;

  const caseKey = keyPart(cleanText(doc.requirementCase?.caseKey));
  if (caseKey) return `BACKFILL:REQCASE:${caseKey}`;

  const entryId = keyPart(cleanText(doc.entryId));
  if (entryId) return `BACKFILL:ENTRY:${keyPart(doc.organisationId)}:${entryId}`;

  const sha = keyPart(cleanText(doc.fileSha256));
  if (sha) return `BACKFILL:SHA256:${sha}`;

  return `BACKFILL:DOCUMENT:${keyPart(doc.id)}`;
}

function includesAny(haystack: string, needles: string[]): boolean {
  const hay = haystack.toLowerCase();
  return needles.some((needle) => hay.includes(needle));
}

function normalizeOutcome(doc: DocumentProjection): {
  outcome: string | null;
  hasCompletionRequest: boolean;
  hasInjunction: boolean;
  hasApproval: boolean;
} {
  const hay = [
    doc.decisionType,
    doc.legalStatus,
    doc.subject,
    doc.originalName,
    doc.requirementCase?.documentType,
  ]
    .map((item) => cleanText(item))
    .filter(Boolean)
    .join(' ');

  const hasCompletionRequest = includesAny(hay, [
    'komplettering',
    'komplettera',
    'forelaggande om komplettering',
  ]);
  const hasInjunction = includesAny(hay, ['forelaggande', 'forbud', 'injunction']);
  const hasApproval = includesAny(hay, ['bifall', 'godkand', 'godkaend', 'beviljad', 'tillstand']);
  const hasRejection = includesAny(hay, ['avslag', 'nekad', 'rejected']);
  const withdrawn = includesAny(hay, ['aterkallad', 'withdrawn']);

  let outcome: string | null = null;
  if (hasApproval) outcome = 'APPROVED';
  else if (hasRejection) outcome = 'REJECTED';
  else if (withdrawn) outcome = 'WITHDRAWN';
  else if (hasCompletionRequest) outcome = 'COMPLETION_REQUEST';

  return { outcome, hasCompletionRequest, hasInjunction, hasApproval };
}

function extractEwcCodes(...values: Array<string | null | undefined>): string[] {
  const text = values.map((value) => cleanText(value)).join(' ');
  const matches = text.match(/\b\d{2}\s?\d{2}\s?\d{2}\b/g) || [];
  return [
    ...new Set(matches.map((code) => code.replace(/\s+/g, '').replace(/(\d{2})(\d{2})(\d{2})/, '$1 $2 $3'))),
  ];
}

function toDecisionCaseInput(doc: DocumentProjection): DecisionCaseInput | null {
  const municipality = normalizeMunicipality(doc);
  if (!municipality) return null;

  const outcome = normalizeOutcome(doc);
  const decisionDate = doc.requirementCase?.documentDate || doc.receivedTime || null;

  return {
    externalCaseKey: buildExternalCaseKey(doc, municipality),
    municipality,
    activityType: cleanText(doc.activityCode) || null,
    ewcCodes: extractEwcCodes(doc.wasteType, doc.subject, doc.originalName),
    receivedDate: doc.receivedTime,
    decisionDate,
    outcome: outcome.outcome,
    hasCompletionRequest: outcome.hasCompletionRequest,
    hasInjunction: outcome.hasInjunction,
    hasApproval: outcome.hasApproval,
    dataSource: 'BACKFILL',
    sourceDocumentId: doc.id,
    appRequirementCaseId: doc.requirementCase?.id || null,
  };
}

function decisionCaseCreateFromInput(input: DecisionCaseInput, id: string) {
  return {
    id,
    external_case_key: input.externalCaseKey,
    municipality: input.municipality,
    county: null as string | null,
    activity_type: input.activityType,
    ewc_codes: input.ewcCodes,
    volume_ton: null as number | null,
    received_date: input.receivedDate,
    decision_date: input.decisionDate,
    processing_days: null as number | null,
    outcome: input.outcome,
    has_completion_request: input.hasCompletionRequest,
    has_injunction: input.hasInjunction,
    has_approval: input.hasApproval,
    data_source: input.dataSource,
    source_document_id: input.sourceDocumentId,
    app_requirement_case_id: input.appRequirementCaseId,
    updated_at: new Date(),
  };
}

function decisionCaseUpdateFromInput(input: DecisionCaseInput) {
  return {
    external_case_key: input.externalCaseKey,
    municipality: input.municipality,
    activity_type: input.activityType,
    ewc_codes: input.ewcCodes,
    received_date: input.receivedDate,
    decision_date: input.decisionDate,
    outcome: input.outcome,
    has_completion_request: input.hasCompletionRequest,
    has_injunction: input.hasInjunction,
    has_approval: input.hasApproval,
    data_source: input.dataSource,
    source_document_id: input.sourceDocumentId,
    app_requirement_case_id: input.appRequirementCaseId,
    updated_at: new Date(),
  };
}

function ratio(count: number, total: number): number | null {
  if (total <= 0) return null;
  return count / total;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function buildRequirementTypeProfile(
  cases: Array<{
    ewcCodes: string[];
    activityType: string | null;
    hasCompletionRequest: boolean;
    hasInjunction: boolean;
    hasApproval: boolean;
  }>,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const item of cases) {
    for (const code of item.ewcCodes) increment(counts, `EWC:${code}`);
    if (item.activityType) increment(counts, `ACTIVITY:${item.activityType}`);
    if (item.hasCompletionRequest) increment(counts, 'COMPLETION_REQUEST');
    if (item.hasInjunction) increment(counts, 'INJUNCTION');
    if (item.hasApproval) increment(counts, 'APPROVAL');
  }

  return Object.fromEntries(
    [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 25)
      .map(([key, count]) => [key, Number((count / Math.max(cases.length, 1)).toFixed(4))]),
  );
}

function buildStrictnessScore(input: {
  completionRate: number | null;
  injunctionRate: number | null;
  rejectionRate: number | null;
}): number | null {
  if (input.completionRate == null && input.injunctionRate == null && input.rejectionRate == null)
    return null;
  const score =
    (input.completionRate || 0) * 55 + (input.injunctionRate || 0) * 30 + (input.rejectionRate || 0) * 15;
  return Number(Math.min(100, Math.max(0, score * 100)).toFixed(2));
}

async function main(): Promise<void> {
  loadEnvFile();
  loadEnvFile('.env.local');

  const args = parseArgs(process.argv.slice(2));
  const { prisma } = await import('../db.server');
  const stats: BackfillStats = {
    scanned: 0,
    skippedMissingMunicipality: 0,
    skippedExternalKeyCollision: 0,
    created: 0,
    updated: 0,
    unchangedDryRun: 0,
    profilesUpdated: 0,
  };
  const touchedMunicipalities = new Set<string>();

  if (!args.profilesOnly) {
    const municipalityCandidateWhere = {
      OR: [
        { municipalityNormalized: { not: null } },
        { municipality: { not: null } },
        { requirementCase: { is: { municipality: { not: null } } } },
      ],
    };
    const where = args.municipality
      ? {
          AND: [
            municipalityCandidateWhere,
            {
              OR: [
                { municipalityNormalized: { equals: args.municipality, mode: 'insensitive' as const } },
                { municipality: { equals: args.municipality, mode: 'insensitive' as const } },
                {
                  requirementCase: {
                    is: { municipality: { equals: args.municipality, mode: 'insensitive' as const } },
                  },
                },
              ],
            },
          ],
        }
      : municipalityCandidateWhere;

    const documents = (await prisma.documentRecord.findMany({
      where,
      orderBy: [{ receivedTime: 'desc' }, { updatedAt: 'desc' }],
      take: args.limit,
      select: {
        id: true,
        organisationId: true,
        entryId: true,
        receivedTime: true,
        subject: true,
        originalName: true,
        diskName: true,
        fileSha256: true,
        decisionType: true,
        municipality: true,
        municipalityNormalized: true,
        wasteType: true,
        legalStatus: true,
        activityCode: true,
        requirementCase: {
          select: {
            id: true,
            caseKey: true,
            municipality: true,
            diarienummer: true,
            documentDate: true,
            documentType: true,
          },
        },
      },
    })) as DocumentProjection[];

    for (const doc of documents) {
      stats.scanned++;
      const input = toDecisionCaseInput(doc);
      if (!input) {
        stats.skippedMissingMunicipality++;
        continue;
      }
      touchedMunicipalities.add(input.municipality);

      const existing = await prisma.decision_cases.findUnique({
        where: { external_case_key: input.externalCaseKey },
        select: { id: true, source_document_id: true },
      });

      if (existing?.source_document_id && existing.source_document_id !== input.sourceDocumentId) {
        stats.skippedExternalKeyCollision++;
        continue;
      }

      if (args.dryRun) {
        stats.unchangedDryRun++;
        continue;
      }

      if (existing) {
        await prisma.decision_cases.update({
          where: { id: existing.id },
          data: decisionCaseUpdateFromInput(input),
        });
        stats.updated++;
      } else {
        await prisma.decision_cases.create({
          data: decisionCaseCreateFromInput(input, crypto.randomUUID()),
        });
        stats.created++;
      }
    }
  }

  if (!args.skipProfiles && !args.dryRun) {
    const municipalities =
      touchedMunicipalities.size > 0
        ? [...touchedMunicipalities]
        : (
            await prisma.decision_cases.findMany({
              distinct: ['municipality'],
              select: { municipality: true },
            })
          ).map((item) => item.municipality);

    for (const municipality of municipalities) {
      const cases = await prisma.decision_cases.findMany({
        where: { municipality },
        select: {
          ewc_codes: true,
          activity_type: true,
          has_completion_request: true,
          has_injunction: true,
          has_approval: true,
          processing_days: true,
          outcome: true,
        },
      });

      const casesNorm = cases.map((item) => ({
        ewcCodes: item.ewc_codes,
        activityType: item.activity_type,
        hasCompletionRequest: item.has_completion_request,
        hasInjunction: item.has_injunction,
        hasApproval: item.has_approval,
        processingDays: item.processing_days,
        outcome: item.outcome,
      }));

      const totalCases = casesNorm.length;
      const completionRate = ratio(
        casesNorm.filter((item) => item.hasCompletionRequest).length,
        totalCases,
      );
      const injunctionRate = ratio(casesNorm.filter((item) => item.hasInjunction).length, totalCases);
      const rejectionRate = ratio(casesNorm.filter((item) => item.outcome === 'REJECTED').length, totalCases);

      await prisma.municipality_decision_profile.upsert({
        where: { municipality },
        create: {
          municipality,
          total_cases: totalCases,
          completion_rate: completionRate,
          avg_processing_days: average(
            casesNorm
              .map((item) => item.processingDays)
              .filter((value): value is number => typeof value === 'number'),
          ),
          common_requirement_types: buildRequirementTypeProfile(casesNorm),
          strictness_score: buildStrictnessScore({ completionRate, injunctionRate, rejectionRate }),
          updated_at: new Date(),
        },
        update: {
          total_cases: totalCases,
          completion_rate: completionRate,
          avg_processing_days: average(
            casesNorm
              .map((item) => item.processingDays)
              .filter((value): value is number => typeof value === 'number'),
          ),
          common_requirement_types: buildRequirementTypeProfile(casesNorm),
          strictness_score: buildStrictnessScore({ completionRate, injunctionRate, rejectionRate }),
          updated_at: new Date(),
        },
      });
      stats.profilesUpdated++;
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: args.dryRun ? 'dry-run' : 'write',
        limit: args.limit,
        municipality: args.municipality || null,
        profilesOnly: args.profilesOnly,
        skipProfiles: args.skipProfiles,
        stats,
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
