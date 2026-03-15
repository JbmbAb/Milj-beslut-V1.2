import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CarbonInput,
  CoreModuleKey,
  DispatchQuote,
  DriverJournalEntry,
  LimsReport,
  MapLayerKey,
  Permit,
  ProjectArchiveDocument,
  ProjectPlan,
  TransportBooking,
} from '../types';
import {
  PROJECT_STRUCTURE_SCHEMA_VERSION,
  PROJECT_STRUCTURE_STORAGE_KEY,
  applyCarbonToPlan,
  applyTemplate,
  calculateCarbon,
  countBlockedGates,
  countPassedGates,
  createArchiveDocument,
  createDefaultProjectPlan,
  createPermitArchiveDocument,
  evaluateStageGate,
  mergeArchiveDocument,
  normalizeProjectPlan,
  recommendMapLayers,
} from '../services/projectStructure';

interface AddArchiveInput {
  name: string;
  module: CoreModuleKey;
  category: ProjectArchiveDocument['category'];
  status?: ProjectArchiveDocument['status'];
  tags?: string[];
  storagePath?: string;
}

interface TransportComplianceInput {
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
}

interface TransportComplianceResult {
  quoteId: string;
  bookingId: string;
  journalId: string;
  limsReportId: string | null;
  carbonGate: string;
  documentGate: string;
  preliminary: boolean;
}

interface RemoteSyncState {
  enabled: boolean;
  projectId: string;
  syncing: boolean;
  lastLoadedAt: string;
  lastSavedAt: string;
  error: string;
}

interface ProjectStructureContextValue {
  plan: ProjectPlan;
  setPlan: React.Dispatch<React.SetStateAction<ProjectPlan>>;
  updatePlan: <K extends keyof ProjectPlan>(key: K, value: ProjectPlan[K]) => void;
  addArchiveDocument: (input: AddArchiveInput) => void;
  syncPermitToArchive: (permit: Permit) => void;
  applyTemplatePack: (templateId: string) => Promise<void>;
  evaluateGate: (
    gateId: string,
    context?: {
      permitType?: string;
      codeType?: 'SNI' | 'EWC';
      permitSubmitted?: boolean;
      mapLayerAvailable?: MapLayerKey[];
      note?: string;
    }
  ) => Promise<{ changed: boolean; status: string }>;
  runCarbonCalculation: (input: CarbonInput) => Promise<void>;
  runTransportComplianceFlow: (input: TransportComplianceInput) => Promise<TransportComplianceResult>;
  applyMapLayerRecommendation: () => Promise<void>;
  markModuleReady: (module: CoreModuleKey, note?: string) => void;
  loadPlanFromServer: () => Promise<void>;
  savePlanToServer: () => Promise<void>;
  remoteSync: RemoteSyncState;
  gateStats: {
    blocked: number;
    passed: number;
  };
}

const ProjectStructureContext = createContext<ProjectStructureContextValue | null>(null);

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const PROJECT_KEY = 'miljobeslut_admin_project';
const REMOTE_SYNC_DEBOUNCE_MS = 1200;

function makeLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function isHazardousWasteCode(wasteCode: string): boolean {
  return String(wasteCode || '').includes('*');
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveRemoteCredentials(): { token: string; projectId: string } | null {
  if (typeof window === 'undefined') return null;
  const token = String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
  const projectId = String(window.localStorage.getItem(PROJECT_KEY) || '').trim();
  if (!token || !projectId) return null;
  return { token, projectId };
}

export const ProjectStructureProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [plan, setPlan] = useState<ProjectPlan>(() => createDefaultProjectPlan());
  const [remoteSync, setRemoteSync] = useState<RemoteSyncState>({
    enabled: false,
    projectId: '',
    syncing: false,
    lastLoadedAt: '',
    lastSavedAt: '',
    error: '',
  });
  const [remoteBootstrapped, setRemoteBootstrapped] = useState(false);
  const planRef = useRef(plan);
  const skipNextAutoSave = useRef(false);

  useEffect(() => {
    planRef.current = plan;
  }, [plan]);

  const appendLocalAudit = (current: ProjectPlan, action: string, details: string): ProjectPlan => ({
    ...current,
    auditTrail: [
      ...current.auditTrail,
      {
        id: `LOCAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        user: 'System',
        action,
        details,
        immutable: true,
      },
    ],
  });

  /*
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(PROJECT_STRUCTURE_STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed: unknown = JSON.parse(raw);
      let candidate: Partial<ProjectPlan> | null = null;

      if (parsed && typeof parsed === 'object' && 'plan' in parsed) {
        candidate = ((parsed as { plan?: Partial<ProjectPlan> }).plan || null) as Partial<ProjectPlan> | null;
      } else if (parsed && typeof parsed === 'object') {
        candidate = parsed as Partial<ProjectPlan>;
      }

      setPlan(normalizeProjectPlan(candidate));
    } catch (error) {
      console.warn('Could not parse stored project structure. Falling back to defaults.', error);
      setPlan(createDefaultProjectPlan());
    }
  }, []);
  */

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      PROJECT_STRUCTURE_STORAGE_KEY,
      JSON.stringify({
        version: PROJECT_STRUCTURE_SCHEMA_VERSION,
        plan,
      })
    );
  }, [plan]);

  const loadPlanFromServer = useCallback(async () => {
    const credentials = resolveRemoteCredentials();
    if (!credentials) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: false,
        projectId: '',
        syncing: false,
        error: '',
      }));
      return;
    }

    setRemoteSync((prev) => ({
      ...prev,
      enabled: true,
      projectId: credentials.projectId,
      syncing: true,
      error: '',
    }));

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(credentials.projectId)}/plan`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
      });
      const json = (await response.json()) as { ok?: boolean; error?: string; plan?: Partial<ProjectPlan> | null };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }

      if (json.plan) {
        skipNextAutoSave.current = true;
        setPlan(normalizeProjectPlan(json.plan));
      }

      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: false,
        lastLoadedAt: new Date().toISOString(),
        error: '',
      }));
    } catch (error: unknown) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: false,
        error: error instanceof Error ? error.message : 'Remote load failed',
      }));
    }
  }, []);

  const savePlanToServer = useCallback(async () => {
    const credentials = resolveRemoteCredentials();
    if (!credentials) return;

    const currentPlan = normalizeProjectPlan(planRef.current);
    setRemoteSync((prev) => ({
      ...prev,
      enabled: true,
      projectId: credentials.projectId,
      syncing: true,
      error: '',
    }));

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(credentials.projectId)}/plan/save`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan: currentPlan }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string; plan?: Partial<ProjectPlan> };
      if (!response.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${response.status}`);
      }

      if (json.plan) {
        skipNextAutoSave.current = true;
        setPlan(normalizeProjectPlan(json.plan));
      }

      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: false,
        lastSavedAt: new Date().toISOString(),
        error: '',
      }));
    } catch (error: unknown) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: false,
        error: error instanceof Error ? error.message : 'Remote save failed',
      }));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      await loadPlanFromServer();
      if (active) setRemoteBootstrapped(true);
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [loadPlanFromServer]);

  useEffect(() => {
    if (!remoteBootstrapped) return;
    if (skipNextAutoSave.current) {
      skipNextAutoSave.current = false;
      return;
    }

    const credentials = resolveRemoteCredentials();
    if (!credentials) return;

    const timer = window.setTimeout(() => {
      void savePlanToServer();
    }, REMOTE_SYNC_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [plan, remoteBootstrapped, savePlanToServer]);

  const updatePlan = <K extends keyof ProjectPlan,>(key: K, value: ProjectPlan[K]) => {
    setPlan((prev) => ({ ...prev, [key]: value }));
  };

  const addArchiveDocument = useCallback((input: AddArchiveInput) => {
    const nextDoc = createArchiveDocument(input);
    setPlan((prev) =>
      appendLocalAudit(
        {
          ...prev,
          documentArchive: mergeArchiveDocument(prev.documentArchive, nextDoc),
        },
        'Document added',
        `${nextDoc.name} (${nextDoc.category}) added from ${nextDoc.module}.`
      )
    );
  }, []);

  const syncPermitToArchive = useCallback((permit: Permit) => {
    const nextDoc = createPermitArchiveDocument(permit);
    setPlan((prev) =>
      appendLocalAudit(
        {
          ...prev,
          documentArchive: mergeArchiveDocument(prev.documentArchive, nextDoc),
        },
        'Permit synced',
        `${permit.filename} synced to project archive.`
      )
    );
  }, []);

  const applyTemplatePack = useCallback<ProjectStructureContextValue['applyTemplatePack']>(async (templateId) => {
    const credentials = resolveRemoteCredentials();
    if (credentials) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: true,
        error: '',
      }));
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(credentials.projectId)}/template/apply`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateId,
            plan: normalizeProjectPlan(planRef.current),
          }),
        });
        const json = (await response.json()) as { ok?: boolean; error?: string; plan?: Partial<ProjectPlan> };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${response.status}`);
        }
        if (json.plan) {
          skipNextAutoSave.current = true;
          setPlan(normalizeProjectPlan(json.plan));
        }
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          lastSavedAt: new Date().toISOString(),
          error: '',
        }));
        return;
      } catch (error: unknown) {
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          error: error instanceof Error ? error.message : 'Template apply failed',
        }));
      }
    }

    setPlan((prev) =>
      appendLocalAudit(
        applyTemplate(prev, templateId),
        'Template applied',
        `Template ${templateId} was applied to project plan.`
      )
    );
  }, []);

  const evaluateGate = useCallback<ProjectStructureContextValue['evaluateGate']>(async (gateId, context) => {
    const credentials = resolveRemoteCredentials();
    if (credentials) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: true,
        error: '',
      }));
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(credentials.projectId)}/stage-gates/${encodeURIComponent(gateId)}/evaluate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${credentials.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              plan: normalizeProjectPlan(planRef.current),
              permitType: context?.permitType,
              codeType: context?.codeType,
              permitSubmitted: context?.permitSubmitted,
              mapLayerAvailable: context?.mapLayerAvailable,
              note: context?.note,
            }),
          }
        );
        const json = (await response.json()) as {
          ok?: boolean;
          error?: string;
          plan?: Partial<ProjectPlan>;
          changed?: boolean;
          gate?: { status?: string };
        };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${response.status}`);
        }
        if (json.plan) {
          skipNextAutoSave.current = true;
          setPlan(normalizeProjectPlan(json.plan));
        }
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          lastSavedAt: new Date().toISOString(),
          error: '',
        }));
        return {
          changed: Boolean(json.changed),
          status: String(json.gate?.status || 'PENDING'),
        };
      } catch (error: unknown) {
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          error: error instanceof Error ? error.message : 'Stage gate evaluation failed',
        }));
      }
    }

    let result = { changed: false, status: 'PENDING' };
    setPlan((prev) => {
      const evaluated = evaluateStageGate(prev, gateId, context);
      result = { changed: evaluated.changed, status: evaluated.gate.status };
      if (!evaluated.changed) return evaluated.plan;
      return appendLocalAudit(
        evaluated.plan,
        'Stage gate evaluated',
        `${evaluated.gate.type} evaluated as ${evaluated.gate.status}.`
      );
    });
    return result;
  }, []);

  const runCarbonCalculation = useCallback<ProjectStructureContextValue['runCarbonCalculation']>(async (input) => {
    const credentials = resolveRemoteCredentials();
    if (credentials) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: true,
        error: '',
      }));
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(credentials.projectId)}/carbon/calculate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            plan: normalizeProjectPlan(planRef.current),
            carbonInput: input,
          }),
        });
        const json = (await response.json()) as { ok?: boolean; error?: string; plan?: Partial<ProjectPlan> };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${response.status}`);
        }
        if (json.plan) {
          skipNextAutoSave.current = true;
          setPlan(normalizeProjectPlan(json.plan));
        }
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          lastSavedAt: new Date().toISOString(),
          error: '',
        }));
        return;
      } catch (error: unknown) {
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          error: error instanceof Error ? error.message : 'Carbon calculation failed',
        }));
      }
    }

    setPlan((prev) => {
      const result = calculateCarbon(input);
      return appendLocalAudit(
        applyCarbonToPlan(prev, input, result),
        'Carbon calculated',
        `Carbon result ${result.totalKgCo2e.toFixed(2)} kgCO2e (${result.quality}).`
      );
    });
  }, []);

  const runTransportComplianceFlow = useCallback<ProjectStructureContextValue['runTransportComplianceFlow']>(
    async (input) => {
      const credentials = resolveRemoteCredentials();

      if (credentials) {
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
          // TODO: Replace MOCK_FRAKTBORS request mapping with TIMOCOM/Trans.eu adapter when credentials are available.
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
            carbonInput: {
              tons: input.tons,
              distanceKm: input.distanceKm,
              transportMode: 'TRUCK',
              materialType: isHazardousWasteCode(input.wasteCode) ? 'WASTE' : 'SOIL',
            },
          });
          if (carbonPayload.plan) {
            skipNextAutoSave.current = true;
            setPlan(normalizeProjectPlan(carbonPayload.plan));
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

            await callProjectApi<{ report: LimsReport }>(
              `/lims/${encodeURIComponent(limsPayload.report.id)}/verify`,
              {
                reviewer: input.reviewerName,
                signatureId: `PLACEHOLDER-BANKID-LIMS-${Date.now()}`,
                approved: true,
              }
            );
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
            skipNextAutoSave.current = true;
            setPlan(normalizeProjectPlan(documentGatePayload.plan || carbonGatePayload.plan || null));
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

      let localResult: TransportComplianceResult = {
        quoteId: '',
        bookingId: '',
        journalId: '',
        limsReportId: null,
        carbonGate: 'PENDING',
        documentGate: 'PENDING',
        preliminary: true,
      };

      setPlan((previous) => {
        const timestamp = nowIso();
        const quote: DispatchQuote = {
          id: makeLocalId('QUOTE'),
          provider: 'MOCK_FRAKTBORS',
          receiverId: input.receiverId,
          receiverName: input.receiverName,
          wasteCode: input.wasteCode,
          tons: input.tons,
          distanceKm: input.distanceKm,
          estimatedCostSek: Math.round(Math.max(1, input.tons) * Math.max(1, input.distanceKm) * 2.4),
          etaHours: Math.max(1, Number((Math.max(1, input.distanceKm) / 60).toFixed(1))),
          currency: 'SEK',
          createdAt: timestamp,
        };

        const booking: TransportBooking = {
          id: makeLocalId('BOOKING'),
          quoteId: quote.id,
          provider: 'MOCK_FRAKTBORS',
          status: 'BOOKED',
          receiverId: input.receiverId,
          receiverName: input.receiverName,
          wasteCode: input.wasteCode,
          tons: input.tons,
          distanceKm: input.distanceKm,
          co2EstimateKg: Number((input.tons * input.distanceKm * 0.12).toFixed(2)),
          plannedPickupAt: timestamp,
          plannedDeliveryAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
          externalReference: makeLocalId('LOCAL-FB'),
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        const driverSignatureId = `LOCAL-PRELIM-DRIVER-${Date.now()}`;
        const reviewerSignatureId = `LOCAL-PRELIM-REVIEWER-${Date.now()}`;
        const journal: DriverJournalEntry = {
          id: makeLocalId('JOURNAL'),
          bookingId: booking.id,
          driverName: input.driverName,
          vehicleId: input.vehicleId,
          origin: input.origin?.trim() || 'Projektplats',
          destination: input.destination?.trim() || input.receiverName,
          wasteCode: input.wasteCode,
          tons: input.tons,
          startedAt: booking.plannedPickupAt,
          endedAt: booking.plannedDeliveryAt,
          odometerStartKm: 10000,
          odometerEndKm: 10000 + Math.max(1, Math.round(input.distanceKm)),
          gpsTrackHash: makeLocalId('PRELIM-GPS-HASH'),
          status: 'VERIFIED',
          signedByDriver: true,
          signedByReviewer: true,
          driverSignatureId,
          reviewerSignatureId,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        let limsReport: LimsReport | null = null;
        if (isHazardousWasteCode(input.wasteCode)) {
          limsReport = {
            id: makeLocalId('LIMS'),
            bookingId: booking.id,
            sampleId: makeLocalId('SAMPLE'),
            labName: 'Preliminar Lab Feed',
            source: 'MANUAL',
            analyzedAt: timestamp,
            rawReference: makeLocalId('PRELIM-REF'),
            metrics: [
              {
                key: 'Pb',
                value: 0.8,
                unit: 'mg/kg',
                maxAllowed: 1,
                exceeded: false,
              },
            ],
            passed: true,
            verifiedByHuman: true,
            reviewer: input.reviewerName,
            reviewerSignatureId: `LOCAL-PRELIM-LIMS-${Date.now()}`,
            verifiedAt: timestamp,
            createdAt: timestamp,
          };
        }

        const withFlowData: ProjectPlan = {
          ...previous,
          dispatchQuotes: [quote, ...previous.dispatchQuotes],
          transportBookings: [booking, ...previous.transportBookings],
          driverJournals: [journal, ...previous.driverJournals],
          limsReports: limsReport ? [limsReport, ...previous.limsReports] : previous.limsReports,
          auditTrail: [
            ...previous.auditTrail,
            {
              id: makeLocalId('AUDIT'),
              timestamp,
              user: input.driverName,
              action: 'DRIVER_JOURNAL_SIGN',
              details:
                'Preliminar lokal signering av forare. Ej juridiskt bindande utan extern verifiering.',
              immutable: true,
              signatureId: driverSignatureId,
            },
            {
              id: makeLocalId('AUDIT'),
              timestamp,
              user: input.reviewerName,
              action: 'DRIVER_JOURNAL_SIGN',
              details:
                'Preliminar lokal granskningssignering. Ej juridiskt bindande utan extern verifiering.',
              immutable: true,
              signatureId: reviewerSignatureId,
            },
            ...(limsReport
              ? [
                  {
                    id: makeLocalId('AUDIT'),
                    timestamp,
                    user: input.reviewerName,
                    action: 'LIMS_REPORT_VERIFY',
                    details:
                      'Preliminar lokal LIMS-verifiering. Ackrediterad labb/extern signatur kravs i produktion.',
                    immutable: true,
                    signatureId: limsReport.reviewerSignatureId || undefined,
                  },
                ]
              : []),
          ],
        };

        const carbonInput: CarbonInput = {
          tons: input.tons,
          distanceKm: input.distanceKm,
          transportMode: 'TRUCK',
          materialType: isHazardousWasteCode(input.wasteCode) ? 'WASTE' : 'SOIL',
        };
        const withCarbon = applyCarbonToPlan(withFlowData, carbonInput, calculateCarbon(carbonInput));
        const carbonEvaluation = evaluateStageGate(withCarbon, 'gate-CARBON_CHECK', {
          note: 'Local preliminary carbon gate evaluation from one-click flow.',
        });
        const documentEvaluation = evaluateStageGate(carbonEvaluation.plan, 'gate-DOCUMENT_CONTROL', {
          note: 'Local preliminary document evaluation; external verification still required.',
        });

        const finalized = appendLocalAudit(
          documentEvaluation.plan,
          'Transport flow (local preliminary)',
          `Preliminar kedja skapad: ${quote.id} -> ${booking.id} -> ${journal.id}.`
        );

        localResult = {
          quoteId: quote.id,
          bookingId: booking.id,
          journalId: journal.id,
          limsReportId: limsReport?.id || null,
          carbonGate: carbonEvaluation.gate.status,
          documentGate: documentEvaluation.gate.status,
          preliminary: true,
        };

        return finalized;
      });

      return localResult;
    },
    []
  );

  const applyMapLayerRecommendation = useCallback<ProjectStructureContextValue['applyMapLayerRecommendation']>(async () => {
    const credentials = resolveRemoteCredentials();
    if (credentials) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: true,
        error: '',
      }));
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(credentials.projectId)}/map-layers/recommend`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectType: planRef.current.projectType,
            plan: normalizeProjectPlan(planRef.current),
          }),
        });
        const json = (await response.json()) as { ok?: boolean; error?: string; plan?: Partial<ProjectPlan> };
        if (!response.ok || !json.ok) {
          throw new Error(json.error || `HTTP ${response.status}`);
        }
        if (json.plan) {
          skipNextAutoSave.current = true;
          setPlan(normalizeProjectPlan(json.plan));
        }
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          lastSavedAt: new Date().toISOString(),
          error: '',
        }));
        return;
      } catch (error: unknown) {
        setRemoteSync((prev) => ({
          ...prev,
          enabled: true,
          projectId: credentials.projectId,
          syncing: false,
          error: error instanceof Error ? error.message : 'Map layer recommendation failed',
        }));
      }
    }

    setPlan((prev) =>
      appendLocalAudit(
        {
          ...prev,
          mapLayerSelection: recommendMapLayers(prev.projectType),
        },
        'Map layers recommended',
        `Map layers refreshed for ${prev.projectType}.`
      )
    );
  }, []);

  const markModuleReady = (module: CoreModuleKey, note?: string) => {
    setPlan((prev) => ({
      ...prev,
      moduleIntegrations: prev.moduleIntegrations.map((item) =>
        item.module === module
          ? {
              ...item,
              readiness: 'READY',
              dependencyNote: note?.trim() || item.dependencyNote,
            }
          : item
      ),
    }));
  };

  const value = useMemo<ProjectStructureContextValue>(
    () => ({
      plan,
      setPlan,
      updatePlan,
      addArchiveDocument,
      syncPermitToArchive,
      applyTemplatePack,
      evaluateGate,
      runCarbonCalculation,
      runTransportComplianceFlow,
      applyMapLayerRecommendation,
      markModuleReady,
      loadPlanFromServer,
      savePlanToServer,
      remoteSync,
      gateStats: {
        blocked: countBlockedGates(plan),
        passed: countPassedGates(plan),
      },
    }),
    [
      plan,
      loadPlanFromServer,
      savePlanToServer,
      remoteSync,
      applyTemplatePack,
      evaluateGate,
      addArchiveDocument,
      syncPermitToArchive,
      runCarbonCalculation,
      runTransportComplianceFlow,
      applyMapLayerRecommendation,
    ]
  );

  return <ProjectStructureContext.Provider value={value}>{children}</ProjectStructureContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useProjectStructure = (): ProjectStructureContextValue => {
  const ctx = useContext(ProjectStructureContext);
  if (!ctx) {
    throw new Error('useProjectStructure must be used within a ProjectStructureProvider');
  }
  return ctx;
};
