import crypto from "node:crypto";
import type { LimsMetric, LimsReport, LimsSourceType, TransportBooking } from "../../types";
import { isHazardousWasteCode } from "./transportDispatchService";

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
    key: String(metric.key || "").trim(),
    value,
    unit: String(metric.unit || "").trim(),
    maxAllowed: maxAllowed == null ? null : maxAllowed,
    exceeded: maxAllowed == null ? false : value > maxAllowed,
  };
}

export function isLimsRequiredForBooking(booking: TransportBooking): boolean {
  return isHazardousWasteCode(booking.wasteCode);
}

export function createLimsReport(input: {
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
}): LimsReport {
  const metrics = input.metrics.map(normalizeMetric).filter((metric) => metric.key.length > 0);
  const autoPassed = metrics.every((metric) => !metric.exceeded);
  const passed = typeof input.passed === "boolean" ? Boolean(input.passed) && autoPassed : autoPassed;

  return {
    id: `LIMS-${crypto.randomUUID()}`,
    bookingId: input.bookingId || null,
    sampleId: input.sampleId.trim(),
    labName: input.labName.trim(),
    source: input.source || "MANUAL",
    analyzedAt: parseIsoOrNow(input.analyzedAt),
    rawReference: input.rawReference.trim(),
    metrics,
    passed,
    verifiedByHuman: false,
    reviewer: null,
    reviewerSignatureId: null,
    verifiedAt: null,
    createdAt: nowIso(),
  };
}

export function verifyLimsReport(input: {
  report: LimsReport;
  reviewer: string;
  signatureId: string;
  approved?: boolean;
}): LimsReport {
  const reviewer = input.reviewer.trim();
  const signatureId = input.signatureId.trim();
  if (!reviewer) {
    throw new Error("reviewer is required");
  }
  if (!signatureId) {
    throw new Error("signatureId is required");
  }

  const autoPassed = input.report.metrics.every((metric) => !metric.exceeded);
  const approved = typeof input.approved === "boolean" ? input.approved : true;

  return {
    ...input.report,
    passed: autoPassed && approved,
    verifiedByHuman: true,
    reviewer,
    reviewerSignatureId: signatureId,
    verifiedAt: nowIso(),
  };
}
