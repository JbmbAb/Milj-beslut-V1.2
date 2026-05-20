import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CarbonInput,
  CoreModuleKey,
  DispatchQuote,
  DriverJournalEntry,
  MapLayerKey,
  Permit,
  ProjectArchiveDocument,
  ProjectPlan,
  TransportBooking,
} from '../types';
import {
  countBlockedGates,
  countPassedGates,
  createArchiveDocument,
  createPermitArchiveDocument,
  mergeArchiveDocument,
  normalizeProjectPlan,
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
    },
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
  const [plan, setPlan] = useState<ProjectPlan>(() => normalizeProjectPlan());
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

  const requireRemoteCredentials = useCallback(
    (actionLabel: string): { token: string; projectId: string } => {
      const credentials = resolveRemoteCredentials();
      if (credentials) return credentials;

      setRemoteSync((prev) => ({
        ...prev,
        enabled: false,
        projectId: '',
        syncing: false,
        error: `${actionLabel} kräver inloggad session och aktivt projekt.`,
      }));
      throw new Error(`${actionLabel} kräver inloggad session och aktivt projekt.`);
    },
    [],
  );

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
      const json = (await response.json()) as {
        ok?: boolean;
        error?: string;
        plan?: Partial<ProjectPlan> | null;
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
    if (!credentials) {
      setRemoteSync((prev) => ({
        ...prev,
        enabled: false,
        projectId: '',
        syncing: false,
        error: 'Sparning kräver inloggad session och aktivt projekt.',
      }));
      return;
    }

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

  const updatePlan = <K extends keyof ProjectPlan>(key: K, value: ProjectPlan[K]) => {
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
        `${nextDoc.name} (${nextDoc.category}) added from ${nextDoc.module}.`,
      ),
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
        `${permit.filename} synced to project archive.`,
      ),
    );
  }, []);

  const applyTemplatePack = useCallback<ProjectStructureContextValue['applyTemplatePack']>(
    async (templateId) => {
      const credentials = requireRemoteCredentials('Mallpaket');
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: true,
        error: '',
      }));
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(credentials.projectId)}/template/apply`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${credentials.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              templateId,
              plan: normalizeProjectPlan(planRef.current),
            }),
          },
        );
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
          error: error instanceof Error ? error.message : 'Template apply failed',
        }));
        throw error instanceof Error ? error : new Error('Template apply failed');
      }
    },
    [requireRemoteCredentials],
  );

  const evaluateGate = useCallback<ProjectStructureContextValue['evaluateGate']>(
    async (gateId, context) => {
      const credentials = requireRemoteCredentials('Gate-utvardering');
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
          },
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
        throw error instanceof Error ? error : new Error('Stage gate evaluation failed');
      }
    },
    [requireRemoteCredentials],
  );

  const runCarbonCalculation = useCallback<ProjectStructureContextValue['runCarbonCalculation']>(
    async (input) => {
      const credentials = requireRemoteCredentials('Koldioxidberakning');
      setRemoteSync((prev) => ({
        ...prev,
        enabled: true,
        projectId: credentials.projectId,
        syncing: true,
        error: '',
      }));
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(credentials.projectId)}/carbon/calculate`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${credentials.token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              plan: normalizeProjectPlan(planRef.current),
              carbonInput: input,
            }),
          },
        );
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
          error: error instanceof Error ? error.message : 'Carbon calculation failed',
        }));
        throw error instanceof Error ? error : new Error('Carbon calculation failed');
      }
    },
    [requireRemoteCredentials],
  );

  const runTransportComplianceFlow = useCallback<ProjectStructureContextValue['runTransportComplianceFlow']>(
    async (input) => {
      const credentials = requireRemoteCredentials('Transportflode');
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
        const _journalPayload = await callProjectApi<{ journal: DriverJournalEntry }>(
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
          },
        );

        throw new Error(
          `Transportbokning ${bookingPayload.booking.id} skapades men flodet stoppades: juridiskt bindande forar-/granskningssignatur och verifierad LIMS-kedja maste komma fran riktig integration.`,
        );
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
    },
    [requireRemoteCredentials],
  );

  const applyMapLayerRecommendation = useCallback<
    ProjectStructureContextValue['applyMapLayerRecommendation']
  >(async () => {
    const credentials = requireRemoteCredentials('Kartlagerrekommendation');
    setRemoteSync((prev) => ({
      ...prev,
      enabled: true,
      projectId: credentials.projectId,
      syncing: true,
      error: '',
    }));
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(credentials.projectId)}/map-layers/recommend`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            projectType: planRef.current.projectType,
            plan: normalizeProjectPlan(planRef.current),
          }),
        },
      );
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
        error: error instanceof Error ? error.message : 'Map layer recommendation failed',
      }));
      throw error instanceof Error ? error : new Error('Map layer recommendation failed');
    }
  }, [requireRemoteCredentials]);

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
          : item,
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
    ],
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
