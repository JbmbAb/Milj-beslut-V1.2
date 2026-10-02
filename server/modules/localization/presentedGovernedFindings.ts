/**
 * U20CDF (U30-R2 verification follow-up; owner directive: raw SQL / provider text never reaches a
 * user) -- the presentation of a governed assessment's stored findings in the read-back, its HTTP
 * answer and the governed PDF.
 *
 * Assessments stored before U30-R2 carry the provider's free text inside a NOT_CHECKED layer
 * finding's explanation ('Lagret "<lager>" kunde inte kontrolleras (<rå text>). ...'). Their bytes,
 * identity and replay stay exactly as stored; only what is SHOWN changes: every NOT_CHECKED layer
 * finding (id `finding-notchecked-<lager>`) is presented with the neutral standard text the rule
 * engine writes since U30-R2, never the stored free text. Every other field (id, rule, version,
 * risk level, evidence refs) is passed through unchanged, as is every other finding.
 *
 * The wording mirrors LURuleEngine's neutral NOT_CHECKED explanation, which is not exported from
 * the package root (U30R2-REPORT owner question 5); the U20-D suite pins that both stay identical.
 */
import type { AssessmentFinding } from '@miljobeslut/mps-lu';

export const NOT_CHECKED_LAYER_FINDING_ID_PREFIX = 'finding-notchecked-';

export function neutralNotCheckedExplanationSv(layer: string): string {
  return `Lagret "${layer}" kunde inte kontrolleras: källan kunde inte frågas vid bedömningen. Ej kontrollerbart - underlag saknas.`;
}

export function presentGovernedFindings(findings: readonly AssessmentFinding[]): AssessmentFinding[] {
  return findings.map((finding) =>
    finding.risk_level === 'NOT_CHECKED' &&
    typeof finding.finding_id === 'string' &&
    finding.finding_id.startsWith(NOT_CHECKED_LAYER_FINDING_ID_PREFIX) &&
    finding.finding_id.length > NOT_CHECKED_LAYER_FINDING_ID_PREFIX.length
      ? { ...finding, explanation: neutralNotCheckedExplanationSv(finding.finding_id.slice(NOT_CHECKED_LAYER_FINDING_ID_PREFIX.length)) }
      : finding,
  );
}
