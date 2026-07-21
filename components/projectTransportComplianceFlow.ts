import type { DispatchQuote, DriverJournalEntry, ProjectPlan, TransportBooking } from '../types';

type RemoteSyncState = {
  enabled: boolean;
  projectId: string;
  syncing: boolean;
  lastLoadedAt: string;
  lastSavedAt: string;
  error: string;
};

type RemoteProjectCredentials = {
  token: string;
  projectId: string;
};

type TransportComplianceInput = {
  receiverId: string;
  receiverName: string;
  wasteCode: string;
  tons: number;
  distanceKm: number;
  driverName: string;
  vehicleId: string;
  reviewerName: string;
  origin?: string;
  destination?: string;
};

type TransportComplianceResult = {
  quoteId: string;
  bookingId: string;
  journalId: string;
  limsReportId: null;
  carbonGate: 'BLOCKED';
  documentGate: 'BLOCKED';
  preliminary: boolean;
};

type RunRemoteTransportComplianceFlowOptions = {
  credentials: RemoteProjectCredentials;
  input: TransportComplianceInput;
  getCurrentPlan: () => ProjectPlan;
  normalizeProjectPlan: (candidate?: Partial<ProjectPlan> | null) => ProjectPlan;
  applyRemotePlan: (candidate?: Partial<ProjectPlan> | null) => void;
  setRemoteSync: (updater: (prev: RemoteSyncState) => RemoteSyncState) => void;
};

function isHazardousWasteCode(wasteCode: string): boolean {
  return String(wasteCode || '').includes('*');
}

function nowIso(): string {
  return new Date().toISOString();
}

export async function runRemoteTransportComplianceFlow({
  credentials,
  input,
  getCurrentPlan: _getCurrentPlan,
  normalizeProjectPlan: _normalizeProjectPlan,
  applyRemotePlan: _applyRemotePlan,
  setRemoteSync,
}: RunRemoteTransportComplianceFlowOptions): Promise<TransportComplianceResult> {
  const callProjectApi = async <TResponse extends object>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<TResponse> => {
    const response = await fetch(`/api/projects/${encodeURIComponent(credentials.projectId)}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await response.json()) as {
      ok?: boolean;
      error?: string;
    } & TResponse;

    if (!response.ok || !json.ok) {
      throw new Error(json.error || `HTTP ${response.status}`);
    }

    return json;
  };

  setRemoteSync((prev) => ({
    ...prev,
    enabled: true,
    projectId: credentials.projectId,
    syncing: true,
    error: '',
  }));

  try {
    const quotePayload = await callProjectApi<{ quote: DispatchQuote }>('/dispatch/quote', {
      receiverId: input.receiverId,
      receiverName: input.receiverName,
      wasteCode: input.wasteCode,
      tons: input.tons,
      distanceKm: input.distanceKm,
    });

    const bookingPayload = await callProjectApi<{ booking: TransportBooking }>('/dispatch/book', {
      quoteId: quotePayload.quote.id,
    });

    const startedAt = bookingPayload.booking.plannedPickupAt || nowIso();
    const endedAt = bookingPayload.booking.plannedDeliveryAt || nowIso();
    const _journalPayload = await callProjectApi<{ journal: DriverJournalEntry }>('/driver-journals/upsert', {
      journal: {
        bookingId: bookingPayload.booking.id,
        driverName: input.driverName,
        vehicleId: input.vehicleId,
        origin: input.origin?.trim() || 'Projektplats',
        destination: input.destination?.trim() || input.receiverName,
        wasteCode: input.wasteCode,
        tons: input.tons,
        startedAt,
        endedAt,
        odometerStartKm: 10000,
        odometerEndKm: 10000 + Math.max(1, Math.round(input.distanceKm)),
      },
    });

    const truthfulStopMessage = isHazardousWasteCode(input.wasteCode)
      ? 'Transporten bokades och journal skapades, men flodet stoppades eftersom verifierad LIMS-kedja och juridiskt bindande signering saknas.'
      : 'Transporten bokades och journal skapades, men flodet stoppades eftersom juridiskt bindande signering maste ske via BankID eller eIDAS.';

    setRemoteSync((prev) => ({
      ...prev,
      enabled: true,
      projectId: credentials.projectId,
      syncing: false,
      lastSavedAt: nowIso(),
      error: truthfulStopMessage,
    }));

    throw new Error(truthfulStopMessage);
  } catch (error: unknown) {
    setRemoteSync((prev) => ({
      ...prev,
      enabled: true,
      projectId: credentials.projectId,
      syncing: false,
      error: error instanceof Error ? error.message : 'Transport compliance flow failed',
    }));
    throw error instanceof Error ? error : new Error('Transport compliance flow failed');
  }
}
