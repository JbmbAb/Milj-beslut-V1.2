export interface ReviewQueueIntent {
  documentId: string;
  queueType: "LOW_CONFIDENCE" | "DISAGREEMENT";
  fieldName: string;
  proposedValue: string | null;
  confidence: number | null;
  reason: string;
}

const REASON_SEPARATOR = " | ";

function normalizeReason(reason: string | null | undefined): string | null {
  const normalized = String(reason ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function mergeReviewReasons(...reasons: Array<string | null | undefined>): string | null {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const rawReason of reasons) {
    const normalized = normalizeReason(rawReason);
    if (!normalized) continue;

    for (const part of normalized.split(REASON_SEPARATOR)) {
      const trimmed = part.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }

  return merged.length > 0 ? merged.join(REASON_SEPARATOR) : null;
}

export function makeReviewIntentKey(intent: Pick<ReviewQueueIntent, "documentId" | "queueType" | "fieldName">): string {
  return `${intent.documentId}::${intent.queueType}::${intent.fieldName}`;
}

export function dedupeReviewIntents(intents: ReviewQueueIntent[]): ReviewQueueIntent[] {
  const merged = new Map<string, ReviewQueueIntent>();

  for (const intent of intents) {
    const key = makeReviewIntentKey(intent);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...intent });
      continue;
    }

    const preferIncomingValue =
      intent.proposedValue !== null &&
      (existing.proposedValue === null || (intent.confidence ?? -1) >= (existing.confidence ?? -1));

    merged.set(key, {
      ...existing,
      proposedValue: preferIncomingValue ? intent.proposedValue : existing.proposedValue,
      confidence: Math.max(existing.confidence ?? -1, intent.confidence ?? -1) >= 0
        ? Math.max(existing.confidence ?? -1, intent.confidence ?? -1)
        : null,
      reason: mergeReviewReasons(existing.reason, intent.reason) ?? existing.reason,
    });
  }

  return Array.from(merged.values());
}
