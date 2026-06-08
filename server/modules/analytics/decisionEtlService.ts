import crypto from 'node:crypto';
import { prisma } from '../../db/prisma';

export type DecisionEtlOptions = {
  write?: boolean;
  profilesOnly?: boolean;
  skipProfiles?: boolean;
  municipality?: string;
  limit?: number;
};

export type DecisionEtlStats = {
  scanned: number;
  skippedMissingMunicipality: number;
  skippedExternalKeyCollision: number;
  created: number;
  updated: number;
  unchangedDryRun: number;
  profilesUpdated: number;
  requirementsSynced: number;
  riskFeaturesSynced: number;
};

type RequirementProjection = {
  id: string;
  sourceType: string;
  category: string;
  subcategory: string;
  interpretedRequirement: string;
  requirementTextQuote: string;
  codingConfidence: string;
  wasteType: string | null;
  ewcCode: string | null;
  maxAmountTon: string | null;
};

type RequirementCaseProjection = {
  id: string;
  caseKey: string;
  municipality: string | null;
  diarienummer: string | null;
  documentDate: Date | null;
  documentType: string | null;
  requirements: RequirementProjection[];
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
  volumeTon: number | null;
  receivedDate: Date | null;
  decisionDate: Date | null;
  processingDays: number | null;
  outcome: string | null;
  hasCompletionRequest: boolean;
  hasInjunction: boolean;
  hasApproval: boolean;
  dataSource: 'APP_BACKFILL';
  sourceDocumentId: string;
  appRequirementCaseId: string | null;
  requirements: RequirementProjection[];
};

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
  if (diarienummer) return `APP:DIARIE:${keyPart(municipality)}:${diarienummer}`;

  const caseKey = keyPart(cleanText(doc.requirementCase?.caseKey));
  if (caseKey) return `APP:REQCASE:${caseKey}`;

  const entryId = keyPart(cleanText(doc.entryId));
  if (entryId) return `APP:ENTRY:${keyPart(doc.organisationId)}:${entryId}`;

  const sha = keyPart(cleanText(doc.fileSha256));
  if (sha) return `APP:SHA256:${sha}`;

  return `APP:DOCUMENT:${keyPart(doc.id)}`;
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
    'föreläggande om komplettering',
    'forelaggande om komplettering',
  ]);
  const hasInjunction = includesAny(hay, ['föreläggande', 'forelaggande', 'förbud', 'forbud', 'injunction']);
  const hasApproval = includesAny(hay, ['bifall', 'godkänd', 'godkand', 'beviljad', 'tillstånd', 'tillstand']);
  const hasRejection = includesAny(hay, ['avslag', 'nekad', 'rejected']);
  const withdrawn = includesAny(hay, ['återkallad', 'aterkallad', 'withdrawn']);

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

function parseNumericAmount(value: string | null | undefined): number | null {
  const text = cleanText(value).replace(',', '.');
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveVolumeTon(doc: DocumentProjection): number | null {
  const candidates = doc.requirementCase?.requirements
    .map((requirement) => parseNumericAmount(requirement.maxAmountTon))
    .filter((value): value is number => value != null);

  if (candidates && candidates.length > 0) {
    return Math.max(...candidates);
  }

  return parseNumericAmount(doc.wasteType);
}

function toVolumeBucket(volumeTon: number | null): string | null {
  if (volumeTon == null) return null;
  if (volumeTon < 100) return '<100';
  if (volumeTon < 1000) return '100-999';
  if (volumeTon < 10000) return '1000-9999';
  return '10000+';
}

function toProcessingDays(receivedDate: Date | null, decisionDate: Date | null): number | null {
  if (!receivedDate || !decisionDate) return null;
  const diff = decisionDate.getTime() - receivedDate.getTime();
  if (diff < 0) return null;
  return Math.round(diff / 86_400_000);
}

function toDecisionCaseInput(doc: DocumentProjection): DecisionCaseInput | null {
  const municipality = normalizeMunicipality(doc);
  if (!municipality) return null;

  const normalizedOutcome = normalizeOutcome(doc);
  const receivedDate = doc.receivedTime;
  const decisionDate = doc.requirementCase?.documentDate || doc.receivedTime || null;
  const requirements = doc.requirementCase?.requirements ?? [];
  const ewcCodes = [
    ...new Set([
      ...extractEwcCodes(doc.wasteType, doc.subject, doc.originalName),
      ...requirements.flatMap((requirement) => extractEwcCodes(requirement.ewcCode, requirement.wasteType)),
    ]),
  ];

  return {
    externalCaseKey: buildExternalCaseKey(doc, municipality),
    municipality,
    activityType: cleanText(doc.activityCode) || cleanText(doc.requirementCase?.documentType) || null,
    ewcCodes,
    volumeTon: deriveVolumeTon(doc),
    receivedDate,
    decisionDate,
    processingDays: toProcessingDays(receivedDate, decisionDate),
    outcome: normalizedOutcome.outcome,
    hasCompletionRequest: normalizedOutcome.hasCompletionRequest,
    hasInjunction: normalizedOutcome.hasInjunction,
    hasApproval: normalizedOutcome.hasApproval,
    dataSource: 'APP_BACKFILL',
    sourceDocumentId: doc.id,
    appRequirementCaseId: doc.requirementCase?.id || null,
    requirements,
  };
}

function mapRequirementConfidence(value: string): number {
  switch (cleanText(value).toUpperCase()) {
    case 'HIGH':
      return 0.95;
    case 'MEDIUM':
      return 0.75;
    case 'LOW':
      return 0.55;
    default:
      return 0.5;
  }
}

function buildDecisionRequirementRows(input: DecisionCaseInput, decisionCaseId: string) {
  return input.requirements
    .map((requirement) => {
      const requirementText =
        cleanText(requirement.interpretedRequirement) || cleanText(requirement.requirementTextQuote);
      if (!requirementText) return null;

      return {
        id: `dreq-${requirement.id}`,
        decision_case_id: decisionCaseId,
        requirement_type:
          cleanText(requirement.category) ||
          cleanText(requirement.subcategory) ||
          cleanText(requirement.sourceType) ||
          'Övrigt',
        requirement_text: requirementText,
        source_document_id: input.sourceDocumentId,
        confidence: mapRequirementConfidence(requirement.codingConfidence),
        created_at: new Date(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

function buildDecisionRiskFeatureRow(input: DecisionCaseInput, decisionCaseId: string) {
  const haystack = input.requirements
    .flatMap((requirement) => [requirement.interpretedRequirement, requirement.requirementTextQuote])
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const firstEwcCode = input.ewcCodes[0]?.replace(/\s+/g, '') ?? null;
  const ewcCategory = firstEwcCode ? firstEwcCode.slice(0, 2) : null;

  return {
    id: `drisk-${decisionCaseId}`,
    decision_case_id: decisionCaseId,
    has_sampling_plan: includesAny(haystack, ['provtagning', 'provtagningsplan', 'sampling']),
    has_recipient_description: includesAny(haystack, ['recipient', 'dagvatten', 'grundvatten']),
    has_site_plan: includesAny(haystack, ['situationsplan', 'site plan', 'karta', 'ritning']),
    near_water_protection: includesAny(haystack, ['vattenskydd', 'skyddsområde för vatten']),
    near_natura2000: includesAny(haystack, ['natura 2000', 'natura2000']),
    volume_bucket: toVolumeBucket(input.volumeTon),
    ewc_category: ewcCategory,
    created_at: new Date(),
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
  if (input.completionRate == null && input.injunctionRate == null && input.rejectionRate == null) {
    return null;
  }

  const score =
    (input.completionRate || 0) * 55 + (input.injunctionRate || 0) * 30 + (input.rejectionRate || 0) * 15;
  return Number(Math.min(100, Math.max(0, score * 100)).toFixed(2));
}

async function rebuildMunicipalityProfiles(municipalities?: string[]): Promise<number> {
  const list =
    municipalities && municipalities.length > 0
      ? municipalities
      : (
          await prisma.decision_cases.findMany({
            distinct: ['municipality'],
            select: { municipality: true },
          })
        ).map((item) => item.municipality);

  let updated = 0;
  for (const municipality of list) {
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

    const normalized = cases.map((item) => ({
      ewcCodes: item.ewc_codes,
      activityType: item.activity_type,
      hasCompletionRequest: item.has_completion_request,
      hasInjunction: item.has_injunction,
      hasApproval: item.has_approval,
      processingDays: item.processing_days,
      outcome: item.outcome,
    }));

    const totalCases = normalized.length;
    const completionRate = ratio(
      normalized.filter((item) => item.hasCompletionRequest).length,
      totalCases,
    );
    const injunctionRate = ratio(
      normalized.filter((item) => item.hasInjunction).length,
      totalCases,
    );
    const rejectionRate = ratio(
      normalized.filter((item) => item.outcome === 'REJECTED').length,
      totalCases,
    );

    await prisma.municipality_decision_profile.upsert({
      where: { municipality },
      create: {
        municipality,
        total_cases: totalCases,
        completion_rate: completionRate,
        avg_processing_days: average(
          normalized
            .map((item) => item.processingDays)
            .filter((value): value is number => typeof value === 'number'),
        ),
        common_requirement_types: buildRequirementTypeProfile(normalized),
        strictness_score: buildStrictnessScore({ completionRate, injunctionRate, rejectionRate }),
        updated_at: new Date(),
      },
      update: {
        total_cases: totalCases,
        completion_rate: completionRate,
        avg_processing_days: average(
          normalized
            .map((item) => item.processingDays)
            .filter((value): value is number => typeof value === 'number'),
        ),
        common_requirement_types: buildRequirementTypeProfile(normalized),
        strictness_score: buildStrictnessScore({ completionRate, injunctionRate, rejectionRate }),
        updated_at: new Date(),
      },
    });
    updated++;
  }

  return updated;
}

export async function backfillDecisionFacts(options: DecisionEtlOptions = {}) {
  const write = options.write === true;
  const profilesOnly = options.profilesOnly === true;
  const skipProfiles = options.skipProfiles === true;
  const limit = options.limit && options.limit > 0 ? Math.trunc(options.limit) : 500;
  const stats: DecisionEtlStats = {
    scanned: 0,
    skippedMissingMunicipality: 0,
    skippedExternalKeyCollision: 0,
    created: 0,
    updated: 0,
    unchangedDryRun: 0,
    profilesUpdated: 0,
    requirementsSynced: 0,
    riskFeaturesSynced: 0,
  };
  const touchedMunicipalities = new Set<string>();

  if (!profilesOnly) {
    const municipalityCandidateWhere = {
      OR: [
        { municipalityNormalized: { not: null } },
        { municipality: { not: null } },
        { requirementCase: { is: { municipality: { not: null } } } },
      ],
    };
    const where = options.municipality
      ? {
          AND: [
            municipalityCandidateWhere,
            {
              OR: [
                { municipalityNormalized: { equals: options.municipality, mode: 'insensitive' as const } },
                { municipality: { equals: options.municipality, mode: 'insensitive' as const } },
                {
                  requirementCase: {
                    is: { municipality: { equals: options.municipality, mode: 'insensitive' as const } },
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
      take: limit,
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
            requirements: {
              select: {
                id: true,
                sourceType: true,
                category: true,
                subcategory: true,
                interpretedRequirement: true,
                requirementTextQuote: true,
                codingConfidence: true,
                wasteType: true,
                ewcCode: true,
                maxAmountTon: true,
              },
            },
          },
        },
      },
    })) as DocumentProjection[];

    for (const document of documents) {
      stats.scanned++;
      const input = toDecisionCaseInput(document);
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

      if (!write) {
        stats.unchangedDryRun++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const decisionCase =
          existing == null
            ? await tx.decision_cases.create({
                data: {
                  id: crypto.randomUUID(),
                  external_case_key: input.externalCaseKey,
                  municipality: input.municipality,
                  county: null,
                  activity_type: input.activityType,
                  ewc_codes: input.ewcCodes,
                  volume_ton: input.volumeTon,
                  received_date: input.receivedDate,
                  decision_date: input.decisionDate,
                  processing_days: input.processingDays,
                  outcome: input.outcome,
                  has_completion_request: input.hasCompletionRequest,
                  has_injunction: input.hasInjunction,
                  has_approval: input.hasApproval,
                  data_source: input.dataSource,
                  source_document_id: input.sourceDocumentId,
                  app_requirement_case_id: input.appRequirementCaseId,
                  updated_at: new Date(),
                },
              })
            : await tx.decision_cases.update({
                where: { id: existing.id },
                data: {
                  external_case_key: input.externalCaseKey,
                  municipality: input.municipality,
                  activity_type: input.activityType,
                  ewc_codes: input.ewcCodes,
                  volume_ton: input.volumeTon,
                  received_date: input.receivedDate,
                  decision_date: input.decisionDate,
                  processing_days: input.processingDays,
                  outcome: input.outcome,
                  has_completion_request: input.hasCompletionRequest,
                  has_injunction: input.hasInjunction,
                  has_approval: input.hasApproval,
                  data_source: input.dataSource,
                  source_document_id: input.sourceDocumentId,
                  app_requirement_case_id: input.appRequirementCaseId,
                  updated_at: new Date(),
                },
              });

        const requirementRows = buildDecisionRequirementRows(input, decisionCase.id);
        await tx.decision_requirements.deleteMany({
          where: { decision_case_id: decisionCase.id },
        });
        if (requirementRows.length > 0) {
          await tx.decision_requirements.createMany({ data: requirementRows });
        }

        await tx.decision_risk_features.deleteMany({
          where: { decision_case_id: decisionCase.id },
        });
        await tx.decision_risk_features.create({
          data: buildDecisionRiskFeatureRow(input, decisionCase.id),
        });

        stats.requirementsSynced += requirementRows.length;
        stats.riskFeaturesSynced++;
      });

      if (existing) {
        stats.updated++;
      } else {
        stats.created++;
      }
    }
  }

  if (!skipProfiles && write) {
    stats.profilesUpdated = await rebuildMunicipalityProfiles(
      touchedMunicipalities.size > 0 ? [...touchedMunicipalities] : undefined,
    );
  }

  return {
    mode: write ? 'write' : 'dry-run',
    municipality: options.municipality ?? null,
    limit,
    profilesOnly,
    skipProfiles,
    stats,
  };
}
