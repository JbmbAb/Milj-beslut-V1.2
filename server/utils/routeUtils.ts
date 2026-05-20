import { parseBbox } from '../utils/geo/bbox';
import {
  RequirementCaseReviewStatus,
  RequirementVerificationStatus,
} from '../repositories/requirementsRepository';
import { DriverJournalStatus, LimsSourceType, MapLayerKey, ProjectPlan, StageGateType } from '../../types';

export const allowedStageGateTypes: StageGateType[] = [
  'PERMIT_REQUIRED',
  'RISK_REVIEW',
  'DOCUMENT_CONTROL',
  'CARBON_CHECK',
];

export const requirementStatuses: RequirementVerificationStatus[] = [
  'AUTO',
  'REVIEWED',
  'VERIFIED',
  'REJECTED',
];
export const requirementCaseReviewStatuses: RequirementCaseReviewStatus[] = [
  'AUTO',
  'NEEDS_REVIEW',
  'VERIFIED',
  'LOCKED',
];

export function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function routeParam(value: unknown): string {
  return String(firstValue(value) ?? '').trim();
}

export function asBboxTuple(bbox: ReturnType<typeof parseBbox>): [number, number, number, number] {
  return bbox as unknown as [number, number, number, number];
}

export function parseOptionalRequirementStatus(value: unknown): RequirementVerificationStatus | undefined {
  const normalized = firstValue(value);
  if (typeof normalized !== 'string') return undefined;
  return requirementStatuses.includes(normalized as RequirementVerificationStatus)
    ? (normalized as RequirementVerificationStatus)
    : undefined;
}

export function parseOptionalRequirementCaseReviewStatus(
  value: unknown,
): RequirementCaseReviewStatus | undefined {
  const normalized = firstValue(value);
  if (typeof normalized !== 'string') return undefined;
  return requirementCaseReviewStatuses.includes(normalized as RequirementCaseReviewStatus)
    ? (normalized as RequirementCaseReviewStatus)
    : undefined;
}

export function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(firstValue(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export function parseBooleanFlag(value: unknown, fallback: boolean = false): boolean {
  if (value == null) return fallback;
  const normalized = String(firstValue(value)).trim().toLowerCase();
  if (['1', 'true', 'yes', 'ja'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'nej'].includes(normalized)) return false;
  return fallback;
}

export function parseOptionalText(value: unknown): string | undefined {
  const text = String(firstValue(value) ?? '').trim();
  return text || undefined;
}

export function asOptionalProjectPlan(value: unknown): Partial<ProjectPlan> | undefined {
  if (value && typeof value === 'object') {
    return value as Partial<ProjectPlan>;
  }
  return undefined;
}

export function parseMapLayerList(value: unknown): MapLayerKey[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(
      (item) =>
        typeof item === 'string' &&
        [
          'CADASTRE',
          'NATURA2000',
          'FLOOD_RISK',
          'SOIL',
          'INFRASTRUCTURE',
          'GROUNDWATER',
          'PROTECTED_SPECIES',
          'NOISE',
        ].includes(item),
    )
    .map((item) => item as MapLayerKey);
}

export function parseOptionalDriverJournalStatus(value: unknown): DriverJournalStatus | undefined {
  if (typeof value !== 'string') return undefined;
  if (['DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED'].includes(value)) {
    return value as DriverJournalStatus;
  }
  return undefined;
}

export function parseOptionalLimsSource(value: unknown): LimsSourceType | undefined {
  if (typeof value !== 'string') return undefined;
  if (value === 'API' || value === 'SFTP' || value === 'MANUAL') {
    return value;
  }
  return undefined;
}
