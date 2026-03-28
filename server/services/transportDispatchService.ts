import crypto from "node:crypto";
import { logger } from "../logger";
import type {
  DispatchProvider,
  DispatchQuote,
  DriverJournalEntry,
  DriverJournalStatus,
  TransportBooking,
} from "../../types";
import * as transportRepo from "../repositories/transportRepository";
import { prisma } from "../db/prisma";

const EMISSION_FACTOR_KG_CO2E_PER_TON_KM = Number(process.env.LOGISTICS_EMISSION_FACTOR || 0.12);
const BASE_RATE_SEK_PER_TON_KM = Number(process.env.LOGISTICS_BASE_RATE || 2.4);
const HAZARDOUS_SURCHARGE_SEK = Number(process.env.LOGISTICS_HAZARDOUS_SURCHARGE || 1800);
const DEFAULT_DISTANCE_KM = Number(process.env.LOGISTICS_DEFAULT_DISTANCE || 15);
const AVERAGE_SPEED_KMH = Number(process.env.LOGISTICS_AVERAGE_SPEED || 60);
const warnedProviderFallbacks = new Set<string>();

export type DispatchProviderRuntimeValue = DispatchProvider | "NOT_CONFIGURED";

export type DispatchProviderRuntimeStatus = {
  requestedProvider: DispatchProviderRuntimeValue;
  activeProvider: DispatchProviderRuntimeValue;
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

function _deriveJournalStatus(entry: DriverJournalEntry): DriverJournalStatus {
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
  logger.warn(`dispatch: ${message}`);
}

function parseRequestedDispatchProvider(): DispatchProviderRuntimeValue {
  const rawProvider = String(process.env.DISPATCH_PROVIDER_MODE || "")
    .trim()
    .toUpperCase();
  return rawProvider === "TIMOCOM"
    ? "TIMOCOM"
    : rawProvider === "TRANS_EU"
      ? "TRANS_EU"
      : rawProvider === "MOCK_FRAKTBORS"
        ? "MOCK_FRAKTBORS"
        : "NOT_CONFIGURED";
}

function resolveDispatchProvider(requestedProvider: DispatchProviderRuntimeValue): DispatchProviderRuntimeValue {
  if (requestedProvider === "NOT_CONFIGURED") {
    return "NOT_CONFIGURED";
  }

  if (requestedProvider === "MOCK_FRAKTBORS") {
    return "MOCK_FRAKTBORS";
  }

  if (requestedProvider === "TIMOCOM") {
    const hasCredentials = Boolean(String(process.env.TIMOCOM_API_KEY || "").trim());
    if (!hasCredentials) {
      warnProviderFallbackOnce(
        "DISPATCH_PROVIDER_MODE=TIMOCOM saknar TIMOCOM_API_KEY. Transportflodet blockeras tills credential ar satt."
      );
      return "NOT_CONFIGURED";
    }
  }

  if (requestedProvider === "TRANS_EU") {
    const hasCredentials = Boolean(String(process.env.TRANS_EU_API_KEY || "").trim());
    if (!hasCredentials) {
      warnProviderFallbackOnce(
        "DISPATCH_PROVIDER_MODE=TRANS_EU saknar TRANS_EU_API_KEY. Transportflodet blockeras tills credential ar satt."
      );
      return "NOT_CONFIGURED";
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
  if (provider === "MOCK_FRAKTBORS") return "MFB";
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
  if (runtime.activeProvider === "NOT_CONFIGURED") {
    throw new Error(
      "Transportprovider ar inte konfigurerad. Satt DISPATCH_PROVIDER_MODE till TIMOCOM eller TRANS_EU och lagg in motsvarande API-nyckel."
    );
  }
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

export async function createTransportBooking(quote: DispatchQuote, input?: { plannedPickupAt?: string }): Promise<TransportBooking> {
  const pickup = parseIsoOrNow(input?.plannedPickupAt);
  const pickupDate = new Date(pickup);
  const deliveryDate = new Date(pickupDate.getTime() + quote.etaHours * 60 * 60 * 1000);

  const row = await transportRepo.createTransportBooking({
    quoteId: quote.id,
    provider: quote.provider,
    status: "BOOKED",
    receiverId: quote.receiverId,
    receiverName: quote.receiverName,
    wasteCode: quote.wasteCode,
    tons: quote.tons,
    distanceKm: quote.distanceKm,
    co2EstimateKg: Number((quote.tons * quote.distanceKm * EMISSION_FACTOR_KG_CO2E_PER_TON_KM).toFixed(2)),
    plannedPickupAt: pickupDate,
    plannedDeliveryAt: deliveryDate,
    externalReference: `${externalReferencePrefix(quote.provider)}-${Math.floor(Math.random() * 900000 + 100000)}`,
  });

  return {
    ...row,
    provider: row.provider as any,
    status: row.status as any,
    plannedPickupAt: row.plannedPickupAt.toISOString(),
    plannedDeliveryAt: row.plannedDeliveryAt.toISOString(),
    externalReference: row.externalReference || "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getTransportBooking(id: string): Promise<TransportBooking | null> {
  const row = await transportRepo.getTransportBooking(id);
  if (!row) return null;
  return {
    ...row,
    provider: row.provider as any,
    status: row.status as any,
    plannedPickupAt: row.plannedPickupAt.toISOString(),
    plannedDeliveryAt: row.plannedDeliveryAt.toISOString(),
    externalReference: row.externalReference || "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertDriverJournal(input: {
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
}): Promise<DriverJournalEntry> {
  const startedAt = parseIsoOrNow(input.journal.startedAt);
  const odometerStartKm = Math.max(0, Number(input.journal.odometerStartKm || 0));
  
  const gpsTrackHash = input.journal.gpsTrackHash?.trim() || 
    stableTrackHash({
      bookingId: input.journal.bookingId.trim(),
      vehicleId: input.journal.vehicleId.trim(),
      startedAt,
      odometerStartKm,
    });

  let row;
  if (input.journal.id) {
    row = await transportRepo.updateDriverJournal(input.journal.id, {
      endedAt: input.journal.endedAt ? new Date(input.journal.endedAt) : undefined,
      odometerEndKm: input.journal.odometerEndKm ?? undefined,
      status: input.journal.status,
    });
  } else {
    row = await transportRepo.createDriverJournal({
      bookingId: input.journal.bookingId.trim(),
      driverName: input.journal.driverName.trim(),
      vehicleId: input.journal.vehicleId.trim(),
      origin: input.journal.origin.trim(),
      destination: input.journal.destination.trim(),
      wasteCode: input.journal.wasteCode.trim(),
      tons: Math.max(0.1, Number(input.journal.tons || 0)),
      startedAt: new Date(startedAt),
      odometerStartKm,
      gpsTrackHash,
      status: input.journal.status || "DRAFT",
    });
  }

  return {
    ...row,
    status: row.status as any,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() || null,
    driverSignatureId: row.driverSignatureId || null,
    reviewerSignatureId: row.reviewerSignatureId || null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    gpsTrackHash: row.gpsTrackHash?.trim() || gpsTrackHash,
  };
}

export async function signDriverJournal(input: {
  journalId: string;
  signerRole: "DRIVER" | "REVIEWER";
  signatureId: string;
}): Promise<DriverJournalEntry> {
  const row = await prisma.driverJournal.findUnique({ where: { id: input.journalId } });
  if (!row) throw new Error("Journal not found");

  const signatureId = input.signatureId.trim();
  if (!signatureId) throw new Error("signatureId is required");

  if (input.signerRole === "REVIEWER" && !row.signedByDriver) {
    throw new Error("Driver signature is required before reviewer signature");
  }

  const updated = await transportRepo.updateDriverJournal(input.journalId, {
    signedByDriver: input.signerRole === "DRIVER" ? true : undefined,
    driverSignatureId: input.signerRole === "DRIVER" ? signatureId : undefined,
    signedByReviewer: input.signerRole === "REVIEWER" ? true : undefined,
    reviewerSignatureId: input.signerRole === "REVIEWER" ? signatureId : undefined,
    status: input.signerRole === "REVIEWER" ? "VERIFIED" : "SUBMITTED",
  });

  return {
    ...updated,
    status: updated.status as any,
    startedAt: updated.startedAt.toISOString(),
    endedAt: updated.endedAt?.toISOString() || null,
    driverSignatureId: updated.driverSignatureId || null,
    reviewerSignatureId: updated.reviewerSignatureId || null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    gpsTrackHash: updated.gpsTrackHash || "",
  };
}
