import type {
  CarbonInput,
  CarbonResult,
  CarbonSummary,
  CoreModuleKey,
  DispatchQuote,
  DriverJournalEntry,
  LimsReport,
  MapLayerKey,
  MapLayerSelection,
  ModuleIntegrationStatus,
  ModuleReadiness,
  Permit,
  PermitCodeProfile,
  ProjectArchiveDocument,
  ProjectPlan,
  ProjectStorageArea,
  ProjectStageGate,
  ProjectTemplatePack,
  ProjectType,
  StorageAreaContents,
  TransportBooking,
  SamplingPreparation,
  StageGateType,
} from '../types';
import { resolvePermitCodeProfile } from './mpfEngine';

export const PROJECT_STRUCTURE_STORAGE_KEY = 'miljobeslut_project_structure_v2';
export const PROJECT_STRUCTURE_SCHEMA_VERSION = 2;

const ALL_STAGE_GATES: StageGateType[] = [
  'PERMIT_REQUIRED',
  'RISK_REVIEW',
  'DOCUMENT_CONTROL',
  'CARBON_CHECK',
];

const MODULE_ORDER: CoreModuleKey[] = [
  'PROJECT_MANAGER',
  'PERMIT_PORTAL',
  'LOGISTICS_MARKET',
  'COMPLIANCE_AUDIT',
  'FIELD_SAMPLING',
];

const DEFAULT_MODULE_NOTES: Record<CoreModuleKey, string> = {
  PROJECT_MANAGER: 'Main orchestration is active.',
  PERMIT_PORTAL: 'Permit data can feed plan milestones.',
  LOGISTICS_MARKET: 'Needs route and receiver sync.',
  COMPLIANCE_AUDIT: 'Waiting for immutable signature events.',
  FIELD_SAMPLING: 'Prepare protocol and chain-of-custody templates.',
};

const DEFAULT_SAMPLING_CHECKLIST = [
  { id: 'S1', label: 'Define sample types and legal thresholds', done: false },
  { id: 'S2', label: 'Set accredited lab integration contract', done: false },
  { id: 'S3', label: 'Prepare chain-of-custody document template', done: false },
];

export const TEMPLATE_PACKS: ProjectTemplatePack[] = [
  {
    id: 'ENV_PERMIT_CORE',
    name: 'Miljötillstånd',
    projectType: 'ENV_PERMIT',
    requiredGates: ['PERMIT_REQUIRED', 'RISK_REVIEW', 'DOCUMENT_CONTROL', 'CARBON_CHECK'],
    defaultLayers: {
      base: ['CADASTRE', 'NATURA2000', 'FLOOD_RISK'],
      optional: ['SOIL', 'GROUNDWATER', 'PROTECTED_SPECIES', 'NOISE'],
    },
    defaultChecklist: ['Permit screening', 'Authority dialogue', 'Legal attachment review'],
    defaultDocuments: [
      { name: 'Permit Scope', category: 'PERMIT', module: 'PERMIT_PORTAL' },
      { name: 'Risk Register', category: 'RISK', module: 'PROJECT_MANAGER' },
    ],
  },
  {
    id: 'VA_STANDARD',
    name: 'VA-projekt',
    projectType: 'VA',
    requiredGates: ['RISK_REVIEW', 'DOCUMENT_CONTROL', 'CARBON_CHECK'],
    defaultLayers: {
      base: ['CADASTRE', 'INFRASTRUCTURE', 'FLOOD_RISK'],
      optional: ['SOIL', 'GROUNDWATER', 'NOISE'],
    },
    defaultChecklist: ['Network mapping', 'Pump station review', 'Groundwater impact review'],
    defaultDocuments: [
      { name: 'Technical Layout', category: 'PROJECT_PLAN', module: 'PROJECT_MANAGER' },
      { name: 'Field Sampling Plan', category: 'FIELD', module: 'FIELD_SAMPLING' },
    ],
  },
  {
    id: 'INFRA_STANDARD',
    name: 'Infrastruktur/Anläggning',
    projectType: 'INFRA',
    requiredGates: ['RISK_REVIEW', 'DOCUMENT_CONTROL', 'CARBON_CHECK'],
    defaultLayers: {
      base: ['CADASTRE', 'INFRASTRUCTURE', 'SOIL'],
      optional: ['FLOOD_RISK', 'NOISE', 'GROUNDWATER'],
    },
    defaultChecklist: ['Traffic impact review', 'Site logistics', 'Contractor compliance'],
    defaultDocuments: [
      { name: 'Execution Plan', category: 'PROJECT_PLAN', module: 'PROJECT_MANAGER' },
      { name: 'Mass Handling Plan', category: 'FIELD', module: 'LOGISTICS_MARKET' },
    ],
  },
  {
    id: 'REMEDIATION_STANDARD',
    name: 'Marksanering',
    projectType: 'REMEDIATION',
    requiredGates: ['PERMIT_REQUIRED', 'RISK_REVIEW', 'DOCUMENT_CONTROL', 'CARBON_CHECK'],
    defaultLayers: {
      base: ['CADASTRE', 'SOIL', 'GROUNDWATER'],
      optional: ['NATURA2000', 'FLOOD_RISK', 'PROTECTED_SPECIES'],
    },
    defaultChecklist: ['Contaminant profile', 'Remediation method', 'Control program'],
    defaultDocuments: [
      { name: 'Remediation Method Statement', category: 'RISK', module: 'PROJECT_MANAGER' },
      { name: 'Permit Annex', category: 'PERMIT', module: 'PERMIT_PORTAL' },
    ],
  },
  {
    id: 'ENERGY_STANDARD',
    name: 'Energi/Industri',
    projectType: 'ENERGY',
    requiredGates: ['PERMIT_REQUIRED', 'DOCUMENT_CONTROL', 'CARBON_CHECK'],
    defaultLayers: {
      base: ['CADASTRE', 'INFRASTRUCTURE', 'NOISE'],
      optional: ['SOIL', 'FLOOD_RISK', 'NATURA2000'],
    },
    defaultChecklist: ['Grid connection scope', 'Operational permit matrix', 'Emission controls'],
    defaultDocuments: [
      { name: 'Operational Permit Matrix', category: 'PERMIT', module: 'PERMIT_PORTAL' },
      { name: 'Carbon Baseline', category: 'FINANCE', module: 'PROJECT_MANAGER' },
    ],
  },
];

const TRANSPORT_FACTORS: Record<CarbonInput['transportMode'], Record<CarbonInput['materialType'], number>> = {
  TRUCK: { SOIL: 0.09, ROCK: 0.08, WASTE: 0.12, MIXED: 0.1 },
  RAIL: { SOIL: 0.03, ROCK: 0.028, WASTE: 0.04, MIXED: 0.034 },
  SHIP: { SOIL: 0.015, ROCK: 0.014, WASTE: 0.02, MIXED: 0.017 },
};

const DEFAULT_TEMPLATE_ID = 'ENV_PERMIT_CORE';

function dedupeLayers(input: MapLayerKey[]): MapLayerKey[] {
  return Array.from(new Set(input));
}

function asMapLayer(value: unknown): value is MapLayerKey {
  return (
    value === 'CADASTRE' ||
    value === 'NATURA2000' ||
    value === 'FLOOD_RISK' ||
    value === 'SOIL' ||
    value === 'INFRASTRUCTURE' ||
    value === 'GROUNDWATER' ||
    value === 'PROTECTED_SPECIES' ||
    value === 'NOISE'
  );
}

function normalizeMapLayerList(input: unknown): MapLayerKey[] {
  if (!Array.isArray(input)) return [];
  return dedupeLayers(input.filter(asMapLayer));
}

export function buildPermitCodeProfile(input: {
  code: string;
  codeType: PermitCodeProfile['codeType'];
  municipality?: string;
}): PermitCodeProfile {
  return resolvePermitCodeProfile(input);
}

function adjustPhasesForPermitProfile(
  phases: ProjectPlan['phases'],
  profile: PermitCodeProfile,
  previousTimelineBufferWeeks: number,
): ProjectPlan['phases'] {
  const deltaWeeks = profile.timelineBufferWeeks - Math.max(0, previousTimelineBufferWeeks);

  return phases.map((phase, phaseIndex) => {
    const nextTasks = phase.tasks.map((task) => ({ ...task }));

    if (phaseIndex === 1) {
      const complianceTaskIndex = nextTasks.findIndex((task) => task.type === 'LEGAL');
      if (complianceTaskIndex >= 0) {
        const current = nextTasks[complianceTaskIndex];
        nextTasks[complianceTaskIndex] = {
          ...current,
          duration: Math.max(1, current.duration + deltaWeeks),
        };
      }

      const mpfTask = {
        id: 'MPF-CODE-CHECK',
        title: `MPF code review for ${profile.code}`,
        startWeek: 2,
        duration: Math.max(1, profile.timelineBufferWeeks || 1),
        type: 'LEGAL' as const,
        status: phase.status === 'DONE' ? ('DONE' as const) : ('TODO' as const),
      };
      const existingMpfTaskIndex = nextTasks.findIndex((task) => task.id === mpfTask.id);
      if (existingMpfTaskIndex >= 0) {
        nextTasks[existingMpfTaskIndex] = mpfTask;
      } else {
        nextTasks.push(mpfTask);
      }
    }

    if (phaseIndex >= 2 && deltaWeeks !== 0) {
      nextTasks.forEach((task, index) => {
        nextTasks[index] = {
          ...task,
          startWeek: Math.max(1, task.startWeek + deltaWeeks),
        };
      });
    }

    return {
      ...phase,
      tasks: nextTasks,
    };
  });
}

export function applyPermitCodeSelection(
  plan: ProjectPlan,
  input: {
    code: string;
    codeType: PermitCodeProfile['codeType'];
    municipality?: string;
  },
): { plan: ProjectPlan; profile: PermitCodeProfile } {
  const profile = buildPermitCodeProfile(input);
  const previousProfile = plan.permitCodeProfile;
  const previousRequiredLayers = previousProfile?.requiredMapLayers || [];

  const baseLayers = recommendMapLayers(plan.projectType).base;
  const enabledWithoutPreviousProfileLayers = plan.mapLayerSelection.enabled.filter(
    (layer) => !previousRequiredLayers.includes(layer),
  );
  const nextEnabledLayers = dedupeLayers([
    ...enabledWithoutPreviousProfileLayers,
    ...baseLayers,
    ...profile.requiredMapLayers,
  ]);

  const nextUnavailable = plan.mapLayerSelection.unavailable.filter(
    (layer) => !profile.requiredMapLayers.includes(layer),
  );

  const nextPhases = adjustPhasesForPermitProfile(
    plan.phases,
    profile,
    previousProfile?.timelineBufferWeeks || 0,
  );

  return {
    plan: {
      ...plan,
      phases: nextPhases,
      mapLayerSelection: {
        ...plan.mapLayerSelection,
        enabled: nextEnabledLayers,
        unavailable: nextUnavailable,
      },
      permitCodeProfile: profile,
    },
    profile,
  };
}

export function getTemplatePacks(): ProjectTemplatePack[] {
  return TEMPLATE_PACKS.map((template) => ({ ...template }));
}

export function getTemplateById(templateId?: string): ProjectTemplatePack {
  return TEMPLATE_PACKS.find((template) => template.id === templateId) || TEMPLATE_PACKS[0];
}

export function createDefaultModuleIntegrations(): ModuleIntegrationStatus[] {
  return MODULE_ORDER.map((module) => ({
    module,
    readiness: module === 'PROJECT_MANAGER' || module === 'PERMIT_PORTAL' ? 'READY' : 'NOT_READY',
    dependencyNote: DEFAULT_MODULE_NOTES[module],
  }));
}

export function createDefaultSamplingPreparation(): SamplingPreparation {
  return {
    enabled: false,
    requiresPreparationNow: true,
    protocolTemplate: 'MIFO-Field-Sampling-v1',
    chainOfCustodyTemplate: 'CoC-SWE-2026',
    plannedServiceWindow: 'Q4 2026',
    checklist: DEFAULT_SAMPLING_CHECKLIST.map((item) => ({ ...item })),
  };
}

export function createDefaultMapLayerSelection(templateId: string = DEFAULT_TEMPLATE_ID): MapLayerSelection {
  const template = getTemplateById(templateId);
  return {
    base: dedupeLayers(template.defaultLayers.base),
    optional: dedupeLayers(template.defaultLayers.optional),
    enabled: dedupeLayers(template.defaultLayers.base),
    unavailable: [],
  };
}

export function createDefaultStageGates(templateId: string = DEFAULT_TEMPLATE_ID): ProjectStageGate[] {
  const template = getTemplateById(templateId);
  return ALL_STAGE_GATES.map((gateType) => {
    const required = template.requiredGates.includes(gateType);
    return {
      id: `gate-${gateType}`,
      type: gateType,
      label: gateType.replace(/_/g, ' ').toLowerCase(),
      required,
      status: required ? 'PENDING' : 'NOT_REQUIRED',
    };
  });
}

export function createDefaultCarbonSummary(): CarbonSummary {
  return {
    lastInput: null,
    lastResult: null,
    history: [],
  };
}

function createDefaultPhasesForProjectType(projectType: ProjectType) {
  const common = [
    {
      id: `phase-${projectType}-1`,
      title: 'Initiation and requirements',
      status: 'ONGOING' as const,
      isLocked: false,
      requiresSignature: false,
      tasks: [
        {
          id: `${projectType}-T1`,
          title: 'Scope and stakeholder mapping',
          startWeek: 1,
          duration: 1,
          type: 'ADMIN' as const,
          status: 'ONGOING' as const,
        },
      ],
    },
    {
      id: `phase-${projectType}-2`,
      title: 'Risk, permit and controls',
      status: 'TODO' as const,
      isLocked: false,
      requiresSignature: true,
      tasks: [
        {
          id: `${projectType}-T2`,
          title: 'Prepare controls and compliance package',
          startWeek: 2,
          duration: 2,
          type: 'LEGAL' as const,
          status: 'TODO' as const,
        },
      ],
    },
    {
      id: `phase-${projectType}-3`,
      title: 'Execution and follow-up',
      status: 'TODO' as const,
      isLocked: true,
      requiresSignature: false,
      tasks: [
        {
          id: `${projectType}-T3`,
          title: 'Execute and monitor KPI',
          startWeek: 4,
          duration: 2,
          type: 'TECHNICAL' as const,
          status: 'TODO' as const,
        },
      ],
    },
  ];
  return common;
}

function createTemplateDocuments(template: ProjectTemplatePack): ProjectArchiveDocument[] {
  return template.defaultDocuments.map((doc) =>
    createArchiveDocument({
      name: doc.name,
      category: doc.category,
      module: doc.module,
      status: 'DRAFT',
      tags: ['template', template.projectType.toLowerCase()],
    }),
  );
}

export function createDefaultProjectPlan(): ProjectPlan {
  return {
    name: 'Nytt Projekt',
    revision: 'Utgåva 1',
    projectType: 'ENV_PERMIT',
    templateId: DEFAULT_TEMPLATE_ID,
    background: '',
    description: '',
    goals: [],
    location: { lat: 59.3293, lng: 18.0686, address: '', propertyId: '' },
    stakeholders: [],
    phases: createDefaultPhasesForProjectType('ENV_PERMIT'),
    complianceScore: 0,
    auditTrail: [],
    branding: {
      organizationName: 'Miljobeslut.se',
      logoUrl: '/logo.png',
      layoutTemplate: 'CORPORATE',
      primaryColor: '#0f172a',
    },
    moduleIntegrations: createDefaultModuleIntegrations(),
    documentArchive: [],
    samplingPreparation: createDefaultSamplingPreparation(),
    stageGates: createDefaultStageGates(DEFAULT_TEMPLATE_ID),
    mapLayerSelection: createDefaultMapLayerSelection(DEFAULT_TEMPLATE_ID),
    permitCodeProfile: null,
    dispatchQuotes: [],
    transportBookings: [],
    storageAreas: [],
    driverJournals: [],
    limsReports: [],
    carbonSummary: createDefaultCarbonSummary(),
    predictiveScores: undefined,
  };
}

const ensureChecklist = (candidate?: SamplingPreparation['checklist']) => {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    return DEFAULT_SAMPLING_CHECKLIST.map((item) => ({ ...item }));
  }
  const byId = new Map(candidate.map((item) => [item.id, item]));
  return DEFAULT_SAMPLING_CHECKLIST.map((item) => ({
    ...item,
    ...(byId.get(item.id) || {}),
    done: Boolean(byId.get(item.id)?.done),
  }));
};

const normalizeSamplingPreparation = (candidate?: Partial<SamplingPreparation>): SamplingPreparation => {
  const defaults = createDefaultSamplingPreparation();
  return {
    ...defaults,
    ...(candidate || {}),
    checklist: ensureChecklist(candidate?.checklist),
  };
};

const normalizeModuleIntegrations = (candidate?: ModuleIntegrationStatus[]): ModuleIntegrationStatus[] => {
  const existing = new Map<CoreModuleKey, ModuleIntegrationStatus>();
  if (Array.isArray(candidate)) {
    candidate.forEach((item) => {
      if (item?.module) {
        existing.set(item.module, item);
      }
    });
  }

  return MODULE_ORDER.map((module) => {
    const found = existing.get(module);
    return {
      module,
      readiness: (found?.readiness ||
        (module === 'PROJECT_MANAGER' || module === 'PERMIT_PORTAL'
          ? 'READY'
          : 'NOT_READY')) as ModuleReadiness,
      dependencyNote: found?.dependencyNote?.trim() || DEFAULT_MODULE_NOTES[module],
    };
  });
};

const normalizeArchive = (candidate?: ProjectArchiveDocument[]): ProjectArchiveDocument[] => {
  if (!Array.isArray(candidate)) return [];
  return candidate
    .filter((doc) => Boolean(doc?.name) && Boolean(doc?.module))
    .map((doc, index) => ({
      ...doc,
      id: doc.id || `DOC-normalized-${index}`,
      uploadedAt: doc.uploadedAt || new Date().toISOString(),
      storagePath: doc.storagePath || `/archive/${new Date().getFullYear()}/unnamed`,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
    }));
};

const normalizeProjectType = (value: unknown): ProjectType => {
  if (value === 'VA' || value === 'INFRA' || value === 'REMEDIATION' || value === 'ENERGY') {
    return value;
  }
  return 'ENV_PERMIT';
};

const normalizeStageGates = (candidate: unknown, templateId: string): ProjectStageGate[] => {
  const defaults = createDefaultStageGates(templateId);
  if (!Array.isArray(candidate)) {
    return defaults;
  }

  const byType = new Map<StageGateType, ProjectStageGate>();
  candidate.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const typed = item as Partial<ProjectStageGate>;
    if (!typed.type || !ALL_STAGE_GATES.includes(typed.type)) return;
    byType.set(typed.type, {
      id: typed.id || `gate-${typed.type}`,
      type: typed.type,
      label: typed.label || typed.type.replace(/_/g, ' ').toLowerCase(),
      required: typeof typed.required === 'boolean' ? typed.required : true,
      status: typed.status || 'PENDING',
      reason: typed.reason,
      lastEvaluatedAt: typed.lastEvaluatedAt,
      lastEvaluationHash: typed.lastEvaluationHash,
      details: typed.details,
    });
  });

  return defaults.map((gate) => ({ ...gate, ...(byType.get(gate.type) || {}) }));
};

const normalizeMapLayerSelection = (candidate: unknown, templateId: string): MapLayerSelection => {
  const defaults = createDefaultMapLayerSelection(templateId);
  if (!candidate || typeof candidate !== 'object') {
    return defaults;
  }

  const typed = candidate as Partial<MapLayerSelection>;
  const base = normalizeMapLayerList(typed.base);
  const optional = normalizeMapLayerList(typed.optional);
  const enabled = normalizeMapLayerList(typed.enabled);
  const unavailable = normalizeMapLayerList(typed.unavailable);

  return {
    base: base.length > 0 ? base : defaults.base,
    optional: optional.length > 0 ? optional : defaults.optional,
    enabled: enabled.length > 0 ? enabled : defaults.enabled,
    unavailable,
  };
};

const normalizeCarbonSummary = (candidate: unknown): CarbonSummary => {
  const defaults = createDefaultCarbonSummary();
  if (!candidate || typeof candidate !== 'object') {
    return defaults;
  }
  const typed = candidate as Partial<CarbonSummary>;
  return {
    lastInput: typed.lastInput || null,
    lastResult: typed.lastResult || null,
    history: Array.isArray(typed.history) ? typed.history : [],
  };
};

const normalizePermitCodeProfile = (candidate: unknown): PermitCodeProfile | null => {
  if (!candidate || typeof candidate !== 'object') return null;
  const typed = candidate as Partial<PermitCodeProfile>;
  if (!typed.code || (typed.codeType !== 'SNI' && typed.codeType !== 'EWC')) return null;
  return buildPermitCodeProfile({
    code: typed.code,
    codeType: typed.codeType,
    municipality: typed.municipality || undefined,
  });
};

const normalizeDispatchProvider = (candidate: unknown): DispatchQuote['provider'] => {
  if (candidate === 'TIMOCOM' || candidate === 'TRANS_EU') {
    return candidate;
  }
  return 'NOT_CONFIGURED';
};

const normalizeDispatchQuotes = (candidate: unknown): DispatchQuote[] => {
  if (!Array.isArray(candidate)) return [];
  return candidate
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const typed = item as Partial<DispatchQuote>;
      return {
        id: typed.id || `QUOTE-${index + 1}`,
        provider: normalizeDispatchProvider(typed.provider),
        receiverId: String(typed.receiverId || ''),
        receiverName: String(typed.receiverName || ''),
        wasteCode: String(typed.wasteCode || ''),
        tons: Math.max(0, Number(typed.tons || 0)),
        distanceKm: Math.max(0, Number(typed.distanceKm || 0)),
        estimatedCostSek: Math.max(0, Number(typed.estimatedCostSek || 0)),
        etaHours: Math.max(0, Number(typed.etaHours || 0)),
        currency: 'SEK' as const,
        createdAt: typed.createdAt || new Date().toISOString(),
      };
    })
    .filter((item) => item.receiverId && item.receiverName && item.wasteCode);
};

const normalizeTransportBookings = (candidate: unknown): TransportBooking[] => {
  if (!Array.isArray(candidate)) return [];
  const allowed = ['QUOTED', 'BOOKED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'BLOCKED'];
  return candidate
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const typed = item as Partial<TransportBooking>;
      const status = allowed.includes(String(typed.status || ''))
        ? (typed.status as TransportBooking['status'])
        : 'BOOKED';
      return {
        id: typed.id || `BOOKING-${index + 1}`,
        quoteId: String(typed.quoteId || ''),
        provider: normalizeDispatchProvider(typed.provider),
        status,
        receiverId: String(typed.receiverId || ''),
        receiverName: String(typed.receiverName || ''),
        wasteCode: String(typed.wasteCode || ''),
        tons: Math.max(0, Number(typed.tons || 0)),
        distanceKm: Math.max(0, Number(typed.distanceKm || 0)),
        co2EstimateKg: Math.max(0, Number(typed.co2EstimateKg || 0)),
        plannedPickupAt: typed.plannedPickupAt || new Date().toISOString(),
        plannedDeliveryAt: typed.plannedDeliveryAt || new Date().toISOString(),
        externalReference: String(typed.externalReference || ''),
        createdAt: typed.createdAt || new Date().toISOString(),
        updatedAt: typed.updatedAt || new Date().toISOString(),
      };
    })
    .filter((item) => item.receiverId && item.receiverName && item.wasteCode);
};

const normalizeStorageAreaContents = (candidate: unknown): StorageAreaContents => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return {};
  }

  return Object.entries(candidate as Record<string, unknown>).reduce<StorageAreaContents>(
    (acc, [key, value]) => {
      const numeric = Number(value);
      if (key && Number.isFinite(numeric) && numeric > 0) {
        acc[key] = numeric;
      }
      return acc;
    },
    {},
  );
};

const normalizeStorageAreas = (candidate: unknown): ProjectStorageArea[] => {
  if (!Array.isArray(candidate)) return [];

  return candidate
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const typed = item as Partial<ProjectStorageArea>;
      const createdAt = typed.createdAt || new Date().toISOString();
      return {
        id: typed.id || `STORAGE-${index + 1}`,
        projectId: String(typed.projectId || ''),
        name: String(typed.name || '').trim(),
        description: typed.description == null ? null : String(typed.description),
        capacityM3: Math.max(0, Number(typed.capacityM3 || 0)),
        contents: normalizeStorageAreaContents(typed.contents),
        geometry: typed.geometry,
        createdAt,
        updatedAt: typed.updatedAt || createdAt,
      };
    })
    .filter((item) => item.projectId && item.name);
};

const normalizeDriverJournals = (candidate: unknown): DriverJournalEntry[] => {
  if (!Array.isArray(candidate)) return [];
  const allowed = ['DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED'];
  return candidate
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const typed = item as Partial<DriverJournalEntry>;
      const status = allowed.includes(String(typed.status || ''))
        ? (typed.status as DriverJournalEntry['status'])
        : 'DRAFT';
      return {
        id: typed.id || `JOURNAL-${index + 1}`,
        bookingId: String(typed.bookingId || ''),
        driverName: String(typed.driverName || ''),
        vehicleId: String(typed.vehicleId || ''),
        origin: String(typed.origin || ''),
        destination: String(typed.destination || ''),
        wasteCode: String(typed.wasteCode || ''),
        tons: Math.max(0, Number(typed.tons || 0)),
        startedAt: typed.startedAt || new Date().toISOString(),
        endedAt: typed.endedAt || null,
        odometerStartKm: Math.max(0, Number(typed.odometerStartKm || 0)),
        odometerEndKm: typed.odometerEndKm == null ? null : Math.max(0, Number(typed.odometerEndKm || 0)),
        gpsTrackHash: String(typed.gpsTrackHash || ''),
        status,
        signedByDriver: Boolean(typed.signedByDriver),
        signedByReviewer: Boolean(typed.signedByReviewer),
        driverSignatureId: typed.driverSignatureId || null,
        reviewerSignatureId: typed.reviewerSignatureId || null,
        createdAt: typed.createdAt || new Date().toISOString(),
        updatedAt: typed.updatedAt || new Date().toISOString(),
      };
    })
    .filter((item) => item.bookingId && item.driverName && item.vehicleId);
};

const normalizeLimsReports = (candidate: unknown): LimsReport[] => {
  if (!Array.isArray(candidate)) return [];
  const sources = ['API', 'SFTP', 'MANUAL'];
  return candidate
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => {
      const typed = item as Partial<LimsReport>;
      const source = sources.includes(String(typed.source || ''))
        ? (typed.source as LimsReport['source'])
        : 'MANUAL';
      const metrics = Array.isArray(typed.metrics)
        ? typed.metrics
            .filter((metric) => metric && typeof metric === 'object')
            .map((metric) => {
              const metricTyped = metric as any;
              const value = Number(metricTyped.value || 0);
              const maxAllowed = metricTyped.maxAllowed == null ? null : Number(metricTyped.maxAllowed);
              return {
                key: String(metricTyped.key || ''),
                value,
                unit: String(metricTyped.unit || ''),
                maxAllowed: maxAllowed == null ? null : maxAllowed,
                exceeded: maxAllowed == null ? false : value > maxAllowed,
              };
            })
            .filter((metric) => metric.key)
        : [];

      return {
        id: typed.id || `LIMS-${index + 1}`,
        bookingId: typed.bookingId || null,
        sampleId: String(typed.sampleId || ''),
        labName: String(typed.labName || ''),
        source,
        analyzedAt: typed.analyzedAt || new Date().toISOString(),
        rawReference: String(typed.rawReference || ''),
        metrics,
        passed: typed.passed == null ? metrics.every((metric) => !metric.exceeded) : Boolean(typed.passed),
        verifiedByHuman: Boolean(typed.verifiedByHuman),
        reviewer: typed.reviewer || null,
        reviewerSignatureId: typed.reviewerSignatureId || null,
        verifiedAt: typed.verifiedAt || null,
        createdAt: typed.createdAt || new Date().toISOString(),
      };
    })
    .filter((item) => item.sampleId && item.labName);
};

export function normalizeProjectPlan(candidate?: Partial<ProjectPlan> | null): ProjectPlan {
  const defaults = createDefaultProjectPlan();
  if (!candidate) return defaults;

  const templateId = typeof candidate.templateId === 'string' ? candidate.templateId : defaults.templateId;

  return {
    ...defaults,
    ...candidate,
    projectType: normalizeProjectType(candidate.projectType),
    templateId,
    location: {
      ...defaults.location,
      ...(candidate.location || {}),
    },
    branding: {
      ...defaults.branding,
      ...(candidate.branding || {}),
    },
    goals: Array.isArray(candidate.goals) ? candidate.goals : defaults.goals,
    stakeholders: Array.isArray(candidate.stakeholders) ? candidate.stakeholders : defaults.stakeholders,
    phases:
      Array.isArray(candidate.phases) && candidate.phases.length > 0 ? candidate.phases : defaults.phases,
    auditTrail: Array.isArray(candidate.auditTrail) ? candidate.auditTrail : defaults.auditTrail,
    moduleIntegrations: normalizeModuleIntegrations(candidate.moduleIntegrations),
    documentArchive: normalizeArchive(candidate.documentArchive),
    samplingPreparation: normalizeSamplingPreparation(candidate.samplingPreparation),
    stageGates: normalizeStageGates(candidate.stageGates, templateId),
    mapLayerSelection: normalizeMapLayerSelection(candidate.mapLayerSelection, templateId),
    permitCodeProfile: normalizePermitCodeProfile(candidate.permitCodeProfile),
    dispatchQuotes: normalizeDispatchQuotes(candidate.dispatchQuotes),
    transportBookings: normalizeTransportBookings(candidate.transportBookings),
    storageAreas: normalizeStorageAreas(candidate.storageAreas),
    driverJournals: normalizeDriverJournals(candidate.driverJournals),
    limsReports: normalizeLimsReports(candidate.limsReports),
    carbonSummary: normalizeCarbonSummary(candidate.carbonSummary),
    predictiveScores: candidate.predictiveScores || defaults.predictiveScores,
  };
}

const slugify = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'document';

export const createArchiveDocument = (input: {
  name: string;
  module: CoreModuleKey;
  category: ProjectArchiveDocument['category'];
  status?: ProjectArchiveDocument['status'];
  tags?: string[];
  storagePath?: string;
}): ProjectArchiveDocument => {
  const now = new Date();
  const uploadedAt = now.toISOString();
  const year = now.getFullYear();
  const storagePath = input.storagePath || `/archive/${year}/${slugify(input.name)}`;

  return {
    id: `DOC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: input.name.trim(),
    module: input.module,
    category: input.category,
    status: input.status || 'DRAFT',
    uploadedAt,
    storagePath,
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
};

export function mergeArchiveDocument(
  archive: ProjectArchiveDocument[],
  nextDoc: ProjectArchiveDocument,
): ProjectArchiveDocument[] {
  const duplicate = archive.find(
    (doc) =>
      doc.name.toLowerCase() === nextDoc.name.toLowerCase() &&
      doc.module === nextDoc.module &&
      doc.category === nextDoc.category,
  );

  if (duplicate) return archive;
  return [nextDoc, ...archive];
}

export const createPermitArchiveDocument = (permit: Permit): ProjectArchiveDocument =>
  createArchiveDocument({
    name: `${permit.municipality}-${permit.property_id}-${permit.filename}`,
    module: 'LOGISTICS_MARKET',
    category: 'PERMIT',
    status: permit.decision_type === 'BIFALL' ? 'VERIFIED' : 'DRAFT',
    tags: ['permit', permit.municipality.toLowerCase(), permit.decision_type.toLowerCase()],
    storagePath: `/archive/${new Date().getFullYear()}/permit-${permit.id}-${slugify(permit.property_id)}`,
  });

export function recommendMapLayers(projectType: ProjectType): MapLayerSelection {
  const template = TEMPLATE_PACKS.find((item) => item.projectType === projectType) || TEMPLATE_PACKS[0];
  return {
    base: dedupeLayers(template.defaultLayers.base),
    optional: dedupeLayers(template.defaultLayers.optional),
    enabled: dedupeLayers(template.defaultLayers.base),
    unavailable: [],
  };
}

export function applyTemplate(plan: ProjectPlan, templateId: string): ProjectPlan {
  const template = getTemplateById(templateId);
  const requiredDocs = createTemplateDocuments(template);
  const mergedDocs = requiredDocs.reduce(
    (acc, doc) => mergeArchiveDocument(acc, doc),
    [...plan.documentArchive],
  );

  const checklist = template.defaultChecklist.map((label, index) => ({
    id: `TMP-${template.id}-${index + 1}`,
    label,
    done: false,
  }));

  return normalizeProjectPlan({
    ...plan,
    projectType: template.projectType,
    templateId: template.id,
    phases: createDefaultPhasesForProjectType(template.projectType),
    stageGates: createDefaultStageGates(template.id),
    mapLayerSelection: recommendMapLayers(template.projectType),
    permitCodeProfile: null,
    documentArchive: mergedDocs,
    samplingPreparation: {
      ...plan.samplingPreparation,
      checklist: checklist.length > 0 ? checklist : plan.samplingPreparation.checklist,
    },
  });
}

function resolveGateLabel(type: StageGateType): string {
  if (type === 'PERMIT_REQUIRED') return 'Permit required';
  if (type === 'RISK_REVIEW') return 'Risk review';
  if (type === 'DOCUMENT_CONTROL') return 'Document control';
  return 'Carbon check';
}

function isGatePassedOrNotRequired(gate?: ProjectStageGate): boolean {
  if (!gate) return false;
  return gate.status === 'PASSED' || gate.status === 'NOT_REQUIRED';
}

function upsertGate(gates: ProjectStageGate[], gate: ProjectStageGate): ProjectStageGate[] {
  return gates.map((item) => (item.id === gate.id ? gate : item));
}

function recomputePhaseLocksFromGates(plan: ProjectPlan, gates: ProjectStageGate[]): ProjectPlan['phases'] {
  const permitReady = isGatePassedOrNotRequired(gates.find((gate) => gate.type === 'PERMIT_REQUIRED'));
  const riskReady = isGatePassedOrNotRequired(gates.find((gate) => gate.type === 'RISK_REVIEW'));
  const docReady = isGatePassedOrNotRequired(gates.find((gate) => gate.type === 'DOCUMENT_CONTROL'));
  const carbonReady = isGatePassedOrNotRequired(gates.find((gate) => gate.type === 'CARBON_CHECK'));

  return plan.phases.map((phase, index) => {
    let shouldLock = phase.isLocked;
    if (phase.status === 'DONE') {
      shouldLock = true;
    } else if (index === 0) {
      shouldLock = false;
    } else if (index === 1) {
      shouldLock = !(permitReady && riskReady);
    } else {
      shouldLock = !(permitReady && riskReady && docReady && carbonReady);
    }
    return { ...phase, isLocked: shouldLock };
  });
}

export function evaluateStageGate(
  plan: ProjectPlan,
  gateId: string,
  context?: {
    permitType?: string;
    codeType?: PermitCodeProfile['codeType'];
    permitSubmitted?: boolean;
    mapLayerAvailable?: MapLayerKey[];
    note?: string;
  },
): { plan: ProjectPlan; gate: ProjectStageGate; changed: boolean } {
  const existing = plan.stageGates.find(
    (gate) => gate.id === gateId || gate.type === (gateId as StageGateType),
  );
  if (!existing) {
    throw new Error('Unknown stage gate');
  }

  const gate = { ...existing, label: existing.label || resolveGateLabel(existing.type) };
  if (!gate.required) {
    const next = {
      ...gate,
      status: 'NOT_REQUIRED' as const,
      reason: 'Gate not required by selected template.',
    };
    const unchanged = gate.status === next.status && gate.reason === next.reason;
    const nextGates = unchanged ? plan.stageGates : upsertGate(plan.stageGates, next);
    const nextPhases = unchanged ? plan.phases : recomputePhaseLocksFromGates(plan, nextGates);
    return {
      plan: unchanged ? plan : { ...plan, stageGates: nextGates, phases: nextPhases },
      gate: next,
      changed: !unchanged,
    };
  }

  const permitDocs = plan.documentArchive.filter((doc) => doc.category === 'PERMIT');
  const verifiedDocs = plan.documentArchive.filter((doc) => doc.status === 'VERIFIED');
  const riskDocs = plan.documentArchive.filter((doc) => doc.category === 'RISK');
  const signatureEvents = (plan.auditTrail || []).filter((entry) => Boolean(entry.signatureId));
  const activeTransportBookings = plan.transportBookings.filter(
    (booking) => booking.status !== 'CANCELLED' && booking.status !== 'BLOCKED',
  );
  const verifiedJournals = plan.driverJournals.filter(
    (journal) => journal.status === 'VERIFIED' && journal.signedByDriver && journal.signedByReviewer,
  );
  const unresolvedJournalBookingIds = activeTransportBookings
    .filter((booking) => !verifiedJournals.some((journal) => journal.bookingId === booking.id))
    .map((booking) => booking.id);
  const hazardousBookingIds = activeTransportBookings
    .filter((booking) => String(booking.wasteCode || '').includes('*'))
    .map((booking) => booking.id);
  const verifiedLimsReports = plan.limsReports.filter(
    (report) => report.verifiedByHuman && Boolean(report.reviewerSignatureId),
  );
  const failedHazardousLimsBookingIds = hazardousBookingIds.filter((bookingId) =>
    verifiedLimsReports.some((report) => report.bookingId === bookingId && report.passed === false),
  );
  const missingHazardousLimsBookingIds = hazardousBookingIds.filter(
    (bookingId) => !verifiedLimsReports.some((report) => report.bookingId === bookingId && report.passed),
  );
  const contextMapLayerAvailable = normalizeMapLayerList(context?.mapLayerAvailable || []);
  const resolvedMapLayers =
    contextMapLayerAvailable.length > 0 ? contextMapLayerAvailable : plan.mapLayerSelection.enabled;
  const contextCodeType =
    context?.codeType === 'SNI' || context?.codeType === 'EWC' ? context.codeType : undefined;
  const permitProfile = context?.permitType
    ? buildPermitCodeProfile({
        code: context.permitType,
        codeType: contextCodeType || plan.permitCodeProfile?.codeType || 'SNI',
        municipality: plan.permitCodeProfile?.municipality || undefined,
      })
    : plan.permitCodeProfile;
  const requiredPermitLayers = permitProfile?.requiredMapLayers || [];
  const missingPermitLayers = requiredPermitLayers.filter((layer) => !resolvedMapLayers.includes(layer));

  let status: ProjectStageGate['status'] = 'PENDING';
  let reason = 'Waiting for input.';

  if (gate.type === 'PERMIT_REQUIRED') {
    if (!context?.permitType) {
      status = 'BLOCKED';
      reason = 'Permit type is missing.';
    } else if (!context?.permitSubmitted) {
      status = 'BLOCKED';
      reason = 'Permit has not been submitted.';
    } else if (permitDocs.length === 0) {
      status = 'BLOCKED';
      reason = 'No permit documents linked to project archive.';
    } else if (missingPermitLayers.length > 0) {
      status = 'PENDING';
      reason = `Geofence validation pending for layers: ${missingPermitLayers.join(', ')}.`;
    } else {
      status = 'PASSED';
      reason = `Permit workflow complete (${permitProfile?.regulatoryTrack || 'NOTIFICATION'} track).`;
    }
  } else if (gate.type === 'RISK_REVIEW') {
    const availableLayers = resolvedMapLayers.length;
    const unavailableLayers = plan.mapLayerSelection.unavailable.length;
    if (availableLayers === 0) {
      status = 'BLOCKED';
      reason = 'No map layers enabled for risk review.';
    } else if (missingPermitLayers.length > 0) {
      status = 'BLOCKED';
      reason = `Required geofence layers are missing: ${missingPermitLayers.join(', ')}.`;
    } else if (unavailableLayers > 0) {
      status = 'PENDING';
      reason = `Some map layers are unavailable (${unavailableLayers}).`;
    } else if (riskDocs.length === 0) {
      status = 'BLOCKED';
      reason = 'Risk document is missing in archive.';
    } else {
      status = 'PASSED';
      reason = 'Risk review has map context and supporting documentation.';
    }
  } else if (gate.type === 'DOCUMENT_CONTROL') {
    if (verifiedDocs.length === 0) {
      status = 'BLOCKED';
      reason = 'No verified documents available.';
    } else if (signatureEvents.length === 0) {
      status = 'BLOCKED';
      reason = 'No e-signature event found (BankID/eIDAS).';
    } else if (unresolvedJournalBookingIds.length > 0) {
      status = 'BLOCKED';
      reason = `Driver journals are missing or unverified for bookings: ${unresolvedJournalBookingIds.join(', ')}.`;
    } else if (failedHazardousLimsBookingIds.length > 0) {
      status = 'BLOCKED';
      reason = `One or more hazardous transport LIMS reports failed: ${failedHazardousLimsBookingIds.join(', ')}.`;
    } else if (missingHazardousLimsBookingIds.length > 0) {
      status = 'BLOCKED';
      reason = `Verified LIMS report is missing for hazardous bookings: ${missingHazardousLimsBookingIds.join(', ')}.`;
    } else {
      status = 'PASSED';
      reason = 'Verified documents, signatures, transport journals and LIMS controls satisfy document gate.';
    }
  } else if (gate.type === 'CARBON_CHECK') {
    if (!plan.carbonSummary.lastResult) {
      status = 'BLOCKED';
      reason = 'Carbon calculation is missing.';
    } else {
      status = 'PASSED';
      reason = `Carbon check completed (${plan.carbonSummary.lastResult.totalKgCo2e.toFixed(1)} kgCO2e).`;
    }
  }

  const evaluationPayload = {
    gateId: gate.id,
    type: gate.type,
    status,
    reason,
    permitType: context?.permitType || null,
    codeType: contextCodeType || permitProfile?.codeType || null,
    permitRegulatoryTrack: permitProfile?.regulatoryTrack || null,
    missingPermitLayers,
    permitSubmitted: Boolean(context?.permitSubmitted),
    verifiedDocCount: verifiedDocs.length,
    signatureEventCount: signatureEvents.length,
    activeTransportBookingCount: activeTransportBookings.length,
    unresolvedJournalBookingCount: unresolvedJournalBookingIds.length,
    hazardousBookingCount: hazardousBookingIds.length,
    missingHazardousLimsBookingCount: missingHazardousLimsBookingIds.length,
    failedHazardousLimsBookingCount: failedHazardousLimsBookingIds.length,
    permitDocCount: permitDocs.length,
    riskDocCount: riskDocs.length,
    carbonResultAt: plan.carbonSummary.lastResult?.calculatedAt || null,
    note: context?.note || null,
  };

  const hashSeed = JSON.stringify(evaluationPayload);
  const nextHash = `h${Math.abs(
    hashSeed.split('').reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0),
  )}`;

  const nextGate: ProjectStageGate = {
    ...gate,
    status,
    reason,
    lastEvaluationHash: nextHash,
    lastEvaluatedAt: new Date().toISOString(),
    details: {
      ...(gate.details || {}),
      permitType: context?.permitType || null,
      codeType: contextCodeType || permitProfile?.codeType || null,
      permitSubmitted: Boolean(context?.permitSubmitted),
      mapLayerEnabledCount: plan.mapLayerSelection.enabled.length,
      mapLayerUnavailableCount: plan.mapLayerSelection.unavailable.length,
      missingPermitLayers,
      permitRegulatoryTrack: permitProfile?.regulatoryTrack || null,
      signatureEventCount: signatureEvents.length,
      activeTransportBookingCount: activeTransportBookings.length,
      unresolvedJournalBookingIds,
      hazardousBookingIds,
      missingHazardousLimsBookingIds,
      failedHazardousLimsBookingIds,
      mapLayerAvailableInputCount: contextMapLayerAvailable.length,
      mapLayerResolvedCount: resolvedMapLayers.length,
    },
  };

  const unchanged =
    gate.lastEvaluationHash === nextGate.lastEvaluationHash && gate.status === nextGate.status;
  const nextGates = unchanged ? plan.stageGates : upsertGate(plan.stageGates, nextGate);
  const nextPhases = unchanged ? plan.phases : recomputePhaseLocksFromGates(plan, nextGates);

  return {
    plan: unchanged
      ? plan
      : {
          ...plan,
          stageGates: nextGates,
          phases: nextPhases,
        },
    gate: nextGate,
    changed: !unchanged,
  };
}

export function calculateCarbon(input: CarbonInput): CarbonResult {
  const tons = Math.max(0, Number(input.tons || 0));
  const routedDistance = Number(input.distanceKm || 0);
  const manualDistance = Number(input.manualDistanceKm || 0);
  const hasRoutedDistance = routedDistance > 0;
  const hasManualDistance = manualDistance > 0;
  const distanceKmUsed = hasRoutedDistance ? routedDistance : hasManualDistance ? manualDistance : 25;

  const defaultFactor = TRANSPORT_FACTORS[input.transportMode]?.[input.materialType] || 0.1;
  const factor = Number(input.emissionFactorKgCo2ePerTonKm || defaultFactor);
  const transportKgCo2e = tons * distanceKmUsed * factor;

  const notes: string[] = [];
  if (hasRoutedDistance) {
    notes.push('Distance from map route.');
  } else if (hasManualDistance) {
    notes.push('Manual fallback distance used.');
  } else {
    notes.push('Estimated fallback distance used (25 km).');
  }
  if (input.emissionFactorKgCo2ePerTonKm) {
    notes.push('Custom emission factor provided.');
  }

  return {
    method: 'LOCAL_DISTANCE',
    totalKgCo2e: Number(transportKgCo2e.toFixed(2)),
    distanceKmUsed: Number(distanceKmUsed.toFixed(2)),
    quality: hasRoutedDistance ? 'ROUTED' : hasManualDistance ? 'MANUAL_DISTANCE' : 'ESTIMATED',
    emissionFactorKgCo2ePerTonKm: Number(factor.toFixed(4)),
    breakdown: {
      transportKgCo2e: Number(transportKgCo2e.toFixed(2)),
      notes,
    },
    calculatedAt: new Date().toISOString(),
    inputVersion: `carbon-v${PROJECT_STRUCTURE_SCHEMA_VERSION}`,
  };
}

export function applyCarbonToPlan(plan: ProjectPlan, input: CarbonInput, result?: CarbonResult): ProjectPlan {
  const computed = result || calculateCarbon(input);
  const history = [computed, ...(plan.carbonSummary.history || [])].slice(0, 20);
  return {
    ...plan,
    carbonSummary: {
      lastInput: input,
      lastResult: computed,
      history,
    },
  };
}

export function countReadyModules(plan: ProjectPlan): number {
  return plan.moduleIntegrations.filter((item) => item.readiness === 'READY').length;
}

export function countBlockedGates(plan: ProjectPlan): number {
  return plan.stageGates.filter((gate) => gate.required && gate.status === 'BLOCKED').length;
}

export function countPassedGates(plan: ProjectPlan): number {
  return plan.stageGates.filter((gate) => gate.required && gate.status === 'PASSED').length;
}
