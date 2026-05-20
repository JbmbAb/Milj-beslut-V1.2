import type { LimsMetric, LimsReport, LimsSourceType, TransportBooking } from '../../types';
import { isHazardousWasteCode } from './transportDispatchService';
import * as limsRepo from '../repositories/limsRepository';

function nowIso(): string {
  return new Date().toISOString();
}

function parseIsoOrNow(value?: string): string {
  if (!value) return nowIso();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return nowIso();
  return parsed.toISOString();
}

function normalizeMetric(metric: {
  key: string;
  value: number;
  unit: string;
  maxAllowed?: number | null;
}): LimsMetric {
  const value = Number(metric.value || 0);
  const maxAllowed = metric.maxAllowed == null ? null : Number(metric.maxAllowed);
  return {
    key: String(metric.key || '').trim(),
    value,
    unit: String(metric.unit || '').trim(),
    maxAllowed: maxAllowed == null ? null : maxAllowed,
    exceeded: maxAllowed == null ? false : value > maxAllowed,
  };
}

export function isLimsRequiredForBooking(booking: TransportBooking): boolean {
  return isHazardousWasteCode(booking.wasteCode);
}

export async function createLimsReport(input: {
  bookingId?: string | null;
  sampleId: string;
  labName: string;
  source?: LimsSourceType;
  analyzedAt?: string;
  rawReference: string;
  metrics: Array<{
    key: string;
    value: number;
    unit: string;
    maxAllowed?: number | null;
  }>;
  passed?: boolean;
}): Promise<LimsReport> {
  const metrics = input.metrics.map(normalizeMetric).filter((metric) => metric.key.length > 0);
  const autoPassed = metrics.every((metric) => !metric.exceeded);
  const passed = typeof input.passed === 'boolean' ? Boolean(input.passed) && autoPassed : autoPassed;

  const row = await limsRepo.createLimsReport({
    bookingId: input.bookingId || null,
    sampleId: input.sampleId.trim(),
    labName: input.labName.trim(),
    source: input.source || 'MANUAL',
    analyzedAt: new Date(parseIsoOrNow(input.analyzedAt)),
    rawReference: input.rawReference.trim(),
    metrics: metrics as any,
    passed,
  });

  return {
    ...row,
    source: row.source as LimsSourceType,
    analyzedAt: row.analyzedAt.toISOString(),
    metrics: row.metrics as unknown as LimsMetric[],
    verifiedAt: row.verifiedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function verifyLimsReport(input: {
  reportId: string;
  reviewer: string;
  signatureId: string;
  approved?: boolean;
}): Promise<LimsReport> {
  const report = await limsRepo.getLimsReport(input.reportId);
  if (!report) throw new Error('LimsReport not found');

  const reviewer = input.reviewer.trim();
  const signatureId = input.signatureId.trim();
  if (!reviewer) throw new Error('reviewer is required');
  if (!signatureId) throw new Error('signatureId is required');

  const metrics = report.metrics as unknown as LimsMetric[];
  const autoPassed = metrics.every((metric) => !metric.exceeded);
  const approved = typeof input.approved === 'boolean' ? input.approved : true;
  const passed = autoPassed && approved;

  const row = await limsRepo.verifyLimsReport(input.reportId, {
    reviewer,
    reviewerSignatureId: signatureId,
    verifiedAt: new Date(),
    passed,
  });

  return {
    ...row,
    source: row.source as LimsSourceType,
    analyzedAt: row.analyzedAt.toISOString(),
    metrics: row.metrics as unknown as LimsMetric[],
    verifiedAt: row.verifiedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(),
  };
}
