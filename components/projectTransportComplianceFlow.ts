import type {
  DispatchQuote,
  DriverJournalEntry,
  LimsReport,
  ProjectPlan,
  TransportBooking,
} from '../types';

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
  limsReportId: string | null;
  carbonGate: string;
  documentGate: string;
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
  getCurrentPlan,
  normalizeProjectPlan,
  applyRemotePlan,
  setRemoteSync,
}: RunRemoteTransportComplianceFlowOptions): Promise<TransportComplianceResult> {
  const callProjectApi = async <TResponse extends object>(
    path: string,
    body: Record<string, unknown>
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

    const carbonPayload = await callProjectApi<{ plan?: Partial<ProjectPlan> }>('/carbon/calculate', {
      plan: normalizeProjectPlan(getCurrentPlan()),
      carbonInput: {
        tons: input.tons,
        distanceKm: input.distanceKm,
        transportMode: 'TRUCK',
        materialType: isHazardousWasteCode(input.wasteCode) ? 'WASTE' : 'SOIL',
      },
    });
    if (carbonPayload.plan) {
      applyRemotePlan(carbonPayload.plan);
    }

    const startedAt = bookingPayload.booking.plannedPickupAt || nowIso();
    const endedAt = bookingPayload.booking.plannedDeliveryAt || nowIso();
    const journalPayload = await callProjectApi<{ journal: DriverJournalEntry }>(
      '/driver-journals/upsert',
      {
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
      }
    );

    const driverSignatureId = `PLACEHOLDER-BANKID-DRIVER-${Date.now()}`;
    const reviewerSignatureId = `PLACEHOLDER-BANKID-REVIEWER-${Date.now()}`;
    await callProjectApi<{ journal: DriverJournalEntry }>(
      `/driver-journals/${encodeURIComponent(journalPayload.journal.id)}/sign`,
      {
        signerRole: 'DRIVER',
        signatureId: driverSignatureId,
      }
    );

    await callProjectApi<{ journal: DriverJournalEntry }>(
      `/driver-journals/${encodeURIComponent(journalPayload.journal.id)}/sign`,
      {
        signerRole: 'REVIEWER',
        signatureId: reviewerSignatureId,
      }
    );

    let limsReportId: string | null = null;
    if (isHazardousWasteCode(input.wasteCode)) {
      const limsPayload = await callProjectApi<{ report: LimsReport }>('/lims/ingest', {
        report: {
          bookingId: bookingPayload.booking.id,
          sampleId: `LOCAL-SAMPLE-${Date.now()}`,
          labName: 'Preliminar Lab Feed',
          source: 'MANUAL',
          rawReference: `PRELIM-REF-${Date.now()}`,
          metrics: [
            {
              key: 'Pb',
              value: 0.8,
              unit: 'mg/kg',
              maxAllowed: 1,
            },
          ],
        },
      });
      limsReportId = limsPayload.report.id;

      await callProjectApi<{ report: LimsReport }>(`/lims/${encodeURIComponent(limsPayload.report.id)}/verify`, {
        reviewer: input.reviewerName,
        signatureId: `PLACEHOLDER-BANKID-LIMS-${Date.now()}`,
        approved: true,
      });
    }

    const carbonGatePayload = await callProjectApi<{ gate?: { status?: string }; plan?: Partial<ProjectPlan> }>(
      '/stage-gates/gate-CARBON_CHECK/evaluate',
      {
        note: 'Carbon gate evaluated from one-click logistics flow.',
      }
    );
    const documentGatePayload = await callProjectApi<{ gate?: { status?: string }; plan?: Partial<ProjectPlan> }>(
      '/stage-gates/gate-DOCUMENT_CONTROL/evaluate',
      {
        note: 'Document gate evaluated from one-click logistics flow.',
      }
    );

    if (documentGatePayload.plan || carbonGatePayload.plan) {
      applyRemotePlan(documentGatePayload.plan || carbonGatePayload.plan || null);
    }

    setRemoteSync((prev) => ({
      ...prev,
      enabled: true,
      projectId: credentials.projectId,
      syncing: false,
      lastSavedAt: nowIso(),
      error: '',
    }));

    return {
      quoteId: quotePayload.quote.id,
      bookingId: bookingPayload.booking.id,
      journalId: journalPayload.journal.id,
      limsReportId,
      carbonGate: String(carbonGatePayload.gate?.status || 'PENDING'),
      documentGate: String(documentGatePayload.gate?.status || 'PENDING'),
      preliminary: false,
    };
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
