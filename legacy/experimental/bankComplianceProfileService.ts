/**
 * bankComplianceProfileService.ts
 *
 * Taxonomi-mappning och bankerelaterad scoreprofil för compliance-index.
 *
 * Baserat på INNOVATION_IMPLEMENTATION_PLAN.md avsnitt 1.5:
 *   "taxonomi-mappning per indikator + bankerelaterad scoreprofil i separat API"
 *
 * Funktioner:
 *   - computeBankComplianceProfile()  — beräknar komplett bankprofil för ett projekt
 *   - getBankTaxonomyIndicators()     — listar alla taxonomi-indikatorer
 *   - scoreSingleIndicator()          — poängsätter en enskild indikator
 *
 * Utdata är ett rådgivande scoring-dokument.
 * Ersätter inte juridisk, finansiell eller ESG-revision.
 */

import { logger } from "../../server/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndicatorStatus = "PASS" | "PARTIAL" | "FAIL" | "NOT_APPLICABLE";

export interface TaxonomyIndicator {
  id: string;
  category: "ENVIRONMENTAL" | "SOCIAL" | "GOVERNANCE" | "LEGAL";
  name: string;
  description: string;
  /** Maxpoäng för indikatorn */
  maxScore: number;
  /** EU Taxonomy-förordning (EU) 2020/852 artikel-referens */
  euTaxonomyRef?: string;
}

export interface IndicatorScore {
  indicatorId: string;
  status: IndicatorStatus;
  score: number;
  maxScore: number;
  notes: string;
}

export interface BankComplianceProfile {
  projectId: string;
  computedAt: string;
  /** Poäng 0–100 */
  overallScore: number;
  ratingLabel: "EXCELLENT" | "GOOD" | "ACCEPTABLE" | "WEAK" | "FAILING";
  categoryScores: Record<string, { score: number; maxScore: number; pct: number }>;
  indicators: IndicatorScore[];
  /** Sammanfattande textanalys för kreditkommitté */
  summary: string;
  /** Identifierade kritiska brister */
  criticalGaps: string[];
}

export interface ProjectComplianceData {
  projectId: string;
  /** Finns godkänd miljötillståndsansökan? */
  hasApprovedPermit: boolean;
  /** Finns komplett audit trail med signering? */
  hasVerifiedAuditTrail: boolean;
  /** Är LIMS-rapporter inlämnade och godkända? */
  hasValidLimsReports: boolean;
  /** Är BankID/eIDAS-signerat dokument bifogat? */
  hasSignedDocuments: boolean;
  /** Gate DOCUMENT_CONTROL passerat? */
  documentControlPassed: boolean;
  /** Gate RISK_ASSESSMENT passerat? */
  riskAssessmentPassed: boolean;
  /** Finns GIS-riskanalys genomförd? */
  gisRiskAnalysisDone: boolean;
  /** Finns transportbokning med föraranteckning? */
  hasVerifiedTransportJournal: boolean;
  /** Kvarstående öppna krav */
  openRequirementsCount: number;
  /** Totalt antal krav */
  totalRequirementsCount: number;
}

// ─── Taxonomy Indicators ──────────────────────────────────────────────────────

const TAXONOMY_INDICATORS: ReadonlyArray<TaxonomyIndicator> = [
  // Environmental
  {
    id: "ENV_PERMIT",
    category: "ENVIRONMENTAL",
    name: "Miljötillstånd",
    description: "Godkänt tillstånd eller anmälan enligt MB/MPF finns",
    maxScore: 20,
    euTaxonomyRef: "Art. 9 EU 2020/852",
  },
  {
    id: "ENV_LIMS",
    category: "ENVIRONMENTAL",
    name: "LIMS-analysresultat",
    description: "Validerade laboratorieanalysrapporter för relevanta parametrar",
    maxScore: 15,
    euTaxonomyRef: "Art. 10 EU 2020/852",
  },
  {
    id: "ENV_GIS",
    category: "ENVIRONMENTAL",
    name: "GIS-riskanalys",
    description: "Rumslig riskbedömning genomförd med PostGIS/NVR/SGU-lager",
    maxScore: 10,
    euTaxonomyRef: "Art. 12 EU 2020/852",
  },
  {
    id: "ENV_TRANSPORT",
    category: "ENVIRONMENTAL",
    name: "Transportkedja",
    description: "Verifierad föraranteckning och transportbokning för avfallsflöden",
    maxScore: 10,
  },
  // Social/Governance
  {
    id: "GOV_AUDIT",
    category: "GOVERNANCE",
    name: "Audit trail integritet",
    description: "Blockchain-stil audit trail med verifierad kedjehasning",
    maxScore: 20,
    euTaxonomyRef: "Art. 21 EU 2020/852",
  },
  {
    id: "GOV_SIGN",
    category: "GOVERNANCE",
    name: "Elektronisk signering",
    description: "Nyckeldokument signerade med BankID eller eIDAS",
    maxScore: 10,
    euTaxonomyRef: "Art. 21 EU 2020/852",
  },
  {
    id: "GOV_REQUIREMENTS",
    category: "GOVERNANCE",
    name: "Kravuppfyllelse",
    description: "Andel uppfyllda krav av totalt identifierade krav",
    maxScore: 15,
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function getBankTaxonomyIndicators(): ReadonlyArray<TaxonomyIndicator> {
  return TAXONOMY_INDICATORS;
}

export function scoreSingleIndicator(
  indicator: TaxonomyIndicator,
  data: ProjectComplianceData,
): IndicatorScore {
  let score = 0;
  let status: IndicatorStatus = "FAIL";
  let notes = "";

  switch (indicator.id) {
    case "ENV_PERMIT":
      if (data.hasApprovedPermit) {
        score = indicator.maxScore;
        status = "PASS";
        notes = "Godkänt miljötillstånd registrerat.";
      } else {
        score = 0;
        status = "FAIL";
        notes = "Inget godkänt miljötillstånd registrerat – kritisk brist för kreditbeslut.";
      }
      break;

    case "ENV_LIMS":
      if (data.hasValidLimsReports) {
        score = indicator.maxScore;
        status = "PASS";
        notes = "Giltiga LIMS-rapporter inlämnade och godkända.";
      } else {
        score = Math.round(indicator.maxScore * 0.3);
        status = "PARTIAL";
        notes = "LIMS-rapporter saknas eller ej godkända. Delpoäng för övrig dokumentation.";
      }
      break;

    case "ENV_GIS":
      if (data.gisRiskAnalysisDone) {
        score = indicator.maxScore;
        status = "PASS";
        notes = "GIS-riskanalys genomförd.";
      } else {
        score = 0;
        status = "FAIL";
        notes = "GIS-riskanalys saknas.";
      }
      break;

    case "ENV_TRANSPORT":
      if (data.hasVerifiedTransportJournal) {
        score = indicator.maxScore;
        status = "PASS";
        notes = "Verifierad föraranteckning och transportbokning finns.";
      } else {
        score = 0;
        status = "FAIL";
        notes = "Transportkedja ej dokumenterad.";
      }
      break;

    case "GOV_AUDIT":
      if (data.hasVerifiedAuditTrail) {
        score = indicator.maxScore;
        status = "PASS";
        notes = "Audit trail kryptografiskt verifierad.";
      } else {
        score = Math.round(indicator.maxScore * 0.5);
        status = "PARTIAL";
        notes = "Audit trail finns men verifieringsstatus oklar. Manuell kontroll rekommenderas.";
      }
      break;

    case "GOV_SIGN":
      if (data.hasSignedDocuments && data.documentControlPassed) {
        score = indicator.maxScore;
        status = "PASS";
        notes = "Nyckelhandlingar signerade och gate DOCUMENT_CONTROL passerat.";
      } else if (data.hasSignedDocuments) {
        score = Math.round(indicator.maxScore * 0.7);
        status = "PARTIAL";
        notes = "Signering finns men gate DOCUMENT_CONTROL ej passerat.";
      } else {
        score = 0;
        status = "FAIL";
        notes = "Signerade dokument saknas.";
      }
      break;

    case "GOV_REQUIREMENTS": {
      const total = Math.max(1, data.totalRequirementsCount);
      const fulfilled = total - data.openRequirementsCount;
      const ratio = fulfilled / total;
      score = Math.round(indicator.maxScore * ratio);
      if (ratio >= 1) {
        status = "PASS";
        notes = `Alla ${total} krav uppfyllda.`;
      } else if (ratio >= 0.8) {
        status = "PARTIAL";
        notes = `${fulfilled} av ${total} krav uppfyllda (${Math.round(ratio * 100)}%).`;
      } else {
        status = "FAIL";
        notes = `Endast ${fulfilled} av ${total} krav uppfyllda (${Math.round(ratio * 100)}%). Kritisk brist.`;
      }
      break;
    }

    default:
      status = "NOT_APPLICABLE";
      notes = "Indikator ej tillämpbar på detta projekt.";
  }

  return {
    indicatorId: indicator.id,
    status,
    score,
    maxScore: indicator.maxScore,
    notes,
  };
}

// ─── Profile computation ──────────────────────────────────────────────────────

function toRatingLabel(
  pct: number,
): "EXCELLENT" | "GOOD" | "ACCEPTABLE" | "WEAK" | "FAILING" {
  if (pct >= 90) return "EXCELLENT";
  if (pct >= 75) return "GOOD";
  if (pct >= 55) return "ACCEPTABLE";
  if (pct >= 35) return "WEAK";
  return "FAILING";
}

export function computeBankComplianceProfile(
  data: ProjectComplianceData,
): BankComplianceProfile {
  logger.info(
    `bankComplianceProfile: beräknar profil för projekt ${data.projectId}`,
  );

  const indicators = TAXONOMY_INDICATORS.map((ind) =>
    scoreSingleIndicator(ind, data),
  );

  const maxTotal = TAXONOMY_INDICATORS.reduce((s, i) => s + i.maxScore, 0);
  const scoreTotal = indicators.reduce((s, i) => s + i.score, 0);
  const overallScore = Math.round((scoreTotal / maxTotal) * 100);

  // Beräkna kategoripoäng
  const categoryScores: Record<
    string,
    { score: number; maxScore: number; pct: number }
  > = {};
  for (const ind of TAXONOMY_INDICATORS) {
    const scored = indicators.find((s) => s.indicatorId === ind.id);
    if (!scored) continue;
    if (!categoryScores[ind.category]) {
      categoryScores[ind.category] = { score: 0, maxScore: 0, pct: 0 };
    }
    categoryScores[ind.category].score += scored.score;
    categoryScores[ind.category].maxScore += ind.maxScore;
  }
  for (const cat of Object.keys(categoryScores)) {
    const c = categoryScores[cat];
    c.pct = c.maxScore > 0 ? Math.round((c.score / c.maxScore) * 100) : 0;
  }

  // Kritiska brister
  const criticalGaps = indicators
    .filter((i) => i.status === "FAIL")
    .map((i) => {
      const def = TAXONOMY_INDICATORS.find((d) => d.id === i.indicatorId);
      return def ? `${def.name}: ${i.notes}` : i.notes;
    });

  const ratingLabel = toRatingLabel(overallScore);

  const summary =
    `Bankprofil för projekt ${data.projectId}: totalpoäng ${overallScore}/100 (${ratingLabel}). ` +
    `${criticalGaps.length === 0 ? "Inga kritiska brister identifierade." : `${criticalGaps.length} kritisk(a) brist(er) kräver åtgärd.`}` +
    ` Kravuppfyllelse: ${data.totalRequirementsCount - data.openRequirementsCount}/${data.totalRequirementsCount} krav uppfyllda.`;

  return {
    projectId: data.projectId,
    computedAt: new Date().toISOString(),
    overallScore,
    ratingLabel,
    categoryScores,
    indicators,
    summary,
    criticalGaps,
  };
}
