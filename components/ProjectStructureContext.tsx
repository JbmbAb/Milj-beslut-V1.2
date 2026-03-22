import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CarbonInput,
  CoreModuleKey,
  MapLayerKey,
  Permit,
  ProjectArchiveDocument,
  ProjectPlan,
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
import type { runRemoteTransportComplianceFlow as RunRemoteTransportComplianceFlow } from './projectTransportComplianceFlow';

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
        const { runRemoteTransportComplianceFlow }: { runRemoteTransportComplianceFlow: typeof RunRemoteTransportComplianceFlow } =
          await import('./projectTransportComplianceFlow');

        return runRemoteTransportComplianceFlow({
          credentials,
          input,
          getCurrentPlan: () => planRef.current,
          normalizeProjectPlan,
          applyRemotePlan: (candidate) => {
            skipNextAutoSave.current = true;
            setPlan(normalizeProjectPlan(candidate || null));
          },
          setRemoteSync,
        });
      }

      setRemoteSync((prev) => ({
        ...prev,
        enabled: false,
        syncing: false,
        error: 'Transportflodet ar blockerat tills adminsession, projektkoppling och riktig dispatch-provider ar konfigurerade.',
      }));
      throw new Error(
        'Transportflodet ar blockerat tills adminsession, projektkoppling och riktig dispatch-provider ar konfigurerade.'
      );
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
