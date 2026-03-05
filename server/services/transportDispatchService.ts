import crypto from "node:crypto";
import type {
  DispatchProvider,
  DispatchQuote,
  DriverJournalEntry,
  DriverJournalStatus,
  TransportBooking,
} from "../../types";

const EMISSION_FACTOR_KG_CO2E_PER_TON_KM = 0.12;
const BASE_RATE_SEK_PER_TON_KM = 2.4;
const HAZARDOUS_SURCHARGE_SEK = 1800;
const DEFAULT_DISTANCE_KM = 15;
const AVERAGE_SPEED_KMH = 60;
const warnedProviderFallbacks = new Set<string>();

type DispatchProviderRuntimeStatus = {
  requestedProvider: DispatchProvider;
  activeProvider: DispatchProvider;
  fallbackActive: boolean;
  credentials: {
    timocomConfigured: boolean;
    transEuConfigured: boolean;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function parseIsoOrNow(value?: string): string {
  if (!value) return nowIso();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return nowIso();
  return parsed.toISOString();
}

function stableTrackHash(input: {
  bookingId: string;
  vehicleId: string;
  startedAt: string;
  odometerStartKm: number;
}): string {
  const seed = `${input.bookingId}|${input.vehicleId}|${input.startedAt}|${input.odometerStartKm}`;
  return crypto.createHash("sha256").update(seed).digest("hex");
}

function deriveJournalStatus(entry: DriverJournalEntry): DriverJournalStatus {
  if (entry.signedByDriver && entry.signedByReviewer && entry.endedAt) return "VERIFIED";
  if (entry.signedByReviewer && !entry.signedByDriver) return "REJECTED";
  if (entry.endedAt || entry.signedByDriver) return "SUBMITTED";
  return "DRAFT";
}

function warnProviderFallbackOnce(message: string): void {
  if (warnedProviderFallbacks.has(message)) {
    return;
  }
  warnedProviderFallbacks.add(message);
  console.warn(`[dispatch] ${message}`);
}

function parseRequestedDispatchProvider(): DispatchProvider {
  const rawProvider = String(process.env.DISPATCH_PROVIDER_MODE || "MOCK_FRAKTBORS")
    .trim()
    .toUpperCase();
  return rawProvider === "TIMOCOM" ? "TIMOCOM" : rawProvider === "TRANS_EU" ? "TRANS_EU" : "MOCK_FRAKTBORS";
}

function resolveDispatchProvider(requestedProvider: DispatchProvider): DispatchProvider {
  if (requestedProvider === "TIMOCOM") {
    const hasCredentials = Boolean(String(process.env.TIMOCOM_API_KEY || "").trim());
    if (!hasCredentials) {
      warnProviderFallbackOnce(
        "DISPATCH_PROVIDER_MODE=TIMOCOM saknar TIMOCOM_API_KEY. Faller tillbaka till MOCK_FRAKTBORS."
      );
      return "MOCK_FRAKTBORS";
    }
  }

  if (requestedProvider === "TRANS_EU") {
    const hasCredentials = Boolean(String(process.env.TRANS_EU_API_KEY || "").trim());
    if (!hasCredentials) {
      warnProviderFallbackOnce(
        "DISPATCH_PROVIDER_MODE=TRANS_EU saknar TRANS_EU_API_KEY. Faller tillbaka till MOCK_FRAKTBORS."
      );
      return "MOCK_FRAKTBORS";
    }
  }

  return requestedProvider;
}

export function getDispatchProviderRuntimeStatus(): DispatchProviderRuntimeStatus {
  const requestedProvider = parseRequestedDispatchProvider();
  const activeProvider = resolveDispatchProvider(requestedProvider);
  return {
    requestedProvider,
    activeProvider,
    fallbackActive: requestedProvider !== activeProvider,
    credentials: {
      timocomConfigured: Boolean(String(process.env.TIMOCOM_API_KEY || "").trim()),
      transEuConfigured: Boolean(String(process.env.TRANS_EU_API_KEY || "").trim()),
    },
  };
}

function externalReferencePrefix(provider: DispatchProvider): string {
  if (provider === "TIMOCOM") return "TC";
  if (provider === "TRANS_EU") return "TEU";
  return "FB";
}

export function isHazardousWasteCode(wasteCode: string): boolean {
  return String(wasteCode || "").includes("*");
}

export function createDispatchQuote(input: {
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm?: number;
}): DispatchQuote {
  const runtime = getDispatchProviderRuntimeStatus();
  const tons = Math.max(0.1, Number(input.tons || 0));
  const distanceKm = Math.max(1, Number(input.distanceKm || 0) || DEFAULT_DISTANCE_KM);
  const hazardous = isHazardousWasteCode(input.wasteCode);
  const baseCost = tons * distanceKm * BASE_RATE_SEK_PER_TON_KM;
  const estimatedCostSek = Math.round(baseCost + (hazardous ? HAZARDOUS_SURCHARGE_SEK : 0));
  const etaHours = Math.max(1, Math.round((distanceKm / AVERAGE_SPEED_KMH) * 10) / 10);

  return {
    id: `QUOTE-${crypto.randomUUID()}`,
    provider: runtime.activeProvider,
    receiverId: input.receiverId.trim(),
    receiverName: input.receiverName.trim(),
    wasteCode: String(input.wasteCode || "").trim(),
    tons,
    distanceKm,
    estimatedCostSek,
    etaHours,
    currency: "SEK",
    createdAt: nowIso(),
  };
}

export function createTransportBooking(quote: DispatchQuote, input?: { plannedPickupAt?: string }): TransportBooking {
  const createdAt = nowIso();
  const pickup = parseIsoOrNow(input?.plannedPickupAt);
  const pickupDate = new Date(pickup);
  const deliveryDate = new Date(pickupDate.getTime() + quote.etaHours * 60 * 60 * 1000);

  return {
    id: `BOOKING-${crypto.randomUUID()}`,
    quoteId: quote.id,
    provider: quote.provider,
    status: "BOOKED",
    receiverId: quote.receiverId,
    receiverName: quote.receiverName,
    wasteCode: quote.wasteCode,
    tons: quote.tons,
    distanceKm: quote.distanceKm,
    co2EstimateKg: Number((quote.tons * quote.distanceKm * EMISSION_FACTOR_KG_CO2E_PER_TON_KM).toFixed(2)),
    plannedPickupAt: pickup,
    plannedDeliveryAt: deliveryDate.toISOString(),
    externalReference: `${externalReferencePrefix(quote.provider)}-${Math.floor(Math.random() * 900000 + 100000)}`,
    createdAt,
    updatedAt: createdAt,
  };
}

export function upsertDriverJournal(input: {
  journals: DriverJournalEntry[];
  journal: {
    id?: string;
    bookingId: string;
    driverName: string;
    vehicleId: string;
    origin: string;
    destination: string;
    wasteCode: string;
    tons: number;
    startedAt?: string;
    endedAt?: string | null;
    odometerStartKm: number;
    odometerEndKm?: number | null;
    gpsTrackHash?: string;
    status?: DriverJournalStatus;
  };
}): { journals: DriverJournalEntry[]; journal: DriverJournalEntry } {
  const now = nowIso();
  const existingIndex = input.journals.findIndex((item) => item.id === input.journal.id);
  const existing = existingIndex >= 0 ? input.journals[existingIndex] : null;

  const startedAt = parseIsoOrNow(input.journal.startedAt);
  const endedAt = input.journal.endedAt == null ? null : parseIsoOrNow(input.journal.endedAt);
  const odometerStartKm = Math.max(0, Number(input.journal.odometerStartKm || 0));
  const odometerEndKm =
    input.journal.odometerEndKm == null ? null : Math.max(0, Number(input.journal.odometerEndKm || 0));

  if (odometerEndKm != null && odometerEndKm < odometerStartKm) {
    throw new Error("odometerEndKm must be >= odometerStartKm");
  }

  const draftJournal: DriverJournalEntry = {
    id: existing?.id || input.journal.id || `JOURNAL-${crypto.randomUUID()}`,
    bookingId: input.journal.bookingId.trim(),
    driverName: input.journal.driverName.trim(),
    vehicleId: input.journal.vehicleId.trim(),
    origin: input.journal.origin.trim(),
    destination: input.journal.destination.trim(),
    wasteCode: input.journal.wasteCode.trim(),
    tons: Math.max(0.1, Number(input.journal.tons || 0)),
    startedAt,
    endedAt,
    odometerStartKm,
    odometerEndKm,
    gpsTrackHash:
      input.journal.gpsTrackHash?.trim() ||
      existing?.gpsTrackHash ||
      stableTrackHash({
        bookingId: input.journal.bookingId.trim(),
        vehicleId: input.journal.vehicleId.trim(),
        startedAt,
        odometerStartKm,
      }),
    status: input.journal.status || existing?.status || "DRAFT",
    signedByDriver: existing?.signedByDriver || false,
    signedByReviewer: existing?.signedByReviewer || false,
    driverSignatureId: existing?.driverSignatureId || null,
    reviewerSignatureId: existing?.reviewerSignatureId || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const nextStatus = deriveJournalStatus(draftJournal);
  const nextJournal: DriverJournalEntry = {
    ...draftJournal,
    status: nextStatus,
  };

  const nextJournals =
    existingIndex >= 0
      ? input.journals.map((item, index) => (index === existingIndex ? nextJournal : item))
      : [nextJournal, ...input.journals];

  return {
    journals: nextJournals,
    journal: nextJournal,
  };
}

export function signDriverJournal(input: {
  journal: DriverJournalEntry;
  signerRole: "DRIVER" | "REVIEWER";
  signatureId: string;
}): DriverJournalEntry {
  const signatureId = input.signatureId.trim();
  if (!signatureId) {
    throw new Error("signatureId is required");
  }

  if (input.signerRole === "REVIEWER" && !input.journal.signedByDriver) {
    throw new Error("Driver signature is required before reviewer signature");
  }

  const next: DriverJournalEntry =
    input.signerRole === "DRIVER"
      ? {
          ...input.journal,
          signedByDriver: true,
          driverSignatureId: signatureId,
          updatedAt: nowIso(),
        }
      : {
          ...input.journal,
          signedByReviewer: true,
          reviewerSignatureId: signatureId,
          updatedAt: nowIso(),
        };

  return {
    ...next,
    status: deriveJournalStatus(next),
  };
}
