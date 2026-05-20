import { INTEGRATION_REGISTRY } from '../datasources/integrationRegistry';
import { MIGRATION_SCOPE } from '../migration/scope';
import { CORE_MODEL_MANIFEST } from '../domain/coreModel';

export type ReadinessStatus = 'DONE' | 'PARTIAL' | 'MISSING';

export interface ReadinessCheckItem {
  id: string;
  title: string;
  status: ReadinessStatus;
  evidence: string[];
}

export interface MigrationReadinessReport {
  ok: boolean;
  checkedAt: string;
  summary: { done: number; partial: number; missing: number };
  items: ReadinessCheckItem[];
  integrations: typeof INTEGRATION_REGISTRY;
  scope: typeof MIGRATION_SCOPE;
  coreModel: typeof CORE_MODEL_MANIFEST;
}

function statusScore(status: ReadinessStatus): 0 | 1 | 2 {
  if (status === 'DONE') return 2;
  if (status === 'PARTIAL') return 1;
  return 0;
}

function isIntegrationRegistryOperational(): boolean {
  // “körbart” = varje dependency måste ha runMode/cachePolicy/rateLimits/failureClass/auditRequired definierat.
  return INTEGRATION_REGISTRY.every((d: any) => {
    return (
      typeof d?.id === 'string' &&
      typeof d?.provider === 'string' &&
      Array.isArray(d?.baseUrls) &&
      typeof d?.runMode === 'string' &&
      typeof d?.cachePolicy === 'string' &&
      typeof d?.rateLimits === 'string' &&
      typeof d?.failureClass === 'string' &&
      typeof d?.auditRequired === 'boolean'
    );
  });
}

function runtimeBulkSeparationOk(): boolean {
  // Policy: Bulk/ETL-källor (STAC/Atom/Geotorget) får inte vara i runtime-registry.
  const forbiddenRuntimeMarkers = ['stac', 'geotorget', 'download-opendata', 'atom'];
  return INTEGRATION_REGISTRY.every((d: any) => {
    if (d.runMode !== 'RUNTIME') return true;
    const urls = (d.baseUrls || []).join(' ').toLowerCase();
    return !forbiddenRuntimeMarkers.some((m) => urls.includes(m));
  });
}

export function buildMigrationReadinessReport(): MigrationReadinessReport {
  const coreModelManifest = CORE_MODEL_MANIFEST;
  const registryOk = isIntegrationRegistryOperational();
  const separationOk = runtimeBulkSeparationOk();
  const items: ReadinessCheckItem[] = [
    {
      id: 'domain_case_spine',
      title: 'Case Spine definierad',
      status: 'DONE',
      evidence: ['server/domain/caseSpine.ts', 'server/domain/coreModel.ts (CORE_MODEL_MANIFEST)'],
    },
    {
      id: 'domain_requirements_model',
      title: 'Requirement-modell klar (validerad)',
      status: 'DONE',
      evidence: ['server/domain/requirementsModel.ts', 'server/services/checkListRagService.ts (zod-parse)'],
    },
    {
      id: 'domain_audit_structure',
      title: 'Audit-struktur klar (hash-chain + verifiering)',
      status: 'DONE',
      evidence: [
        'server/security/auditTrail.ts',
        'server/services/auditVerificationScheduler.ts',
        'prisma schema AuditTrail',
      ],
    },
    {
      id: 'architecture_system_boundaries',
      title: 'Systemgränser definierade',
      status: 'DONE',
      evidence: [
        'server/modules/gis (module boundary)',
        'server/modules/ai (policy + gateway)',
        'createApp.ts (router mounting)',
      ],
    },
    {
      id: 'architecture_gis_separated',
      title: 'GIS separerad (modulgräns)',
      status: 'DONE',
      evidence: [
        'server/routes/gis.routes.ts',
        'components/MapView.tsx',
        'server/datasources/mapLayerCatalog.ts',
      ],
    },
    {
      id: 'architecture_ai_separated',
      title: 'AI separerad (gateway + policy)',
      status: 'DONE',
      evidence: [
        'server/services/vertexAiService.ts',
        'server/services/coreAiGatewayService.ts',
        'server/modules/ai/policy.ts',
        'server/services/ragSearchService.ts',
      ],
    },
    {
      id: 'data_scope',
      title: 'Vad som migreras är bestämt (scope kodifierad)',
      status: 'DONE',
      evidence: ['server/migration/scope.ts', 'prisma/schema.prisma (managed vs env.* unmanaged PostGIS)'],
    },
    {
      id: 'data_model_stable',
      title: 'Datamodell stabil',
      status: 'DONE',
      evidence: [
        'prisma/schema.prisma',
        'prisma/spatial/* (raw SQL migrations)',
        'server/domain/requirementsModel.ts',
      ],
    },
    {
      id: 'integrations_mapped',
      title: 'Alla externa beroenden kartlagda',
      status: INTEGRATION_REGISTRY.length >= 4 && registryOk ? 'DONE' : 'PARTIAL',
      evidence: [
        'server/datasources/integrationRegistry.ts',
        registryOk ? 'registry operational: OK' : 'registry operational: FAIL',
      ],
    },
    {
      id: 'integrations_fallbacks',
      title: 'Fallback-strategier finns',
      status: separationOk ? 'DONE' : 'PARTIAL',
      evidence: [
        'property lookup: PostGIS → open-ogc → OAuth (lantmaterietService.ts + property.routes.ts)',
        'Map basemap: OSM default + subscription-key för Lantmäteriet WMS (MapView.tsx)',
        separationOk
          ? 'runtime/bulk separation: OK'
          : 'runtime/bulk separation: FAIL (bulk markers in runtime)',
      ],
    },
    {
      id: 'ai_rag_strategy',
      title: 'RAG-strategi definierad',
      status: 'DONE',
      evidence: ['server/services/ragSearchService.ts (embed → chunks → graph → answer + sources)'],
    },
    {
      id: 'ai_role_split',
      title: 'Rollfördelning AI vs system klar',
      status: 'DONE',
      evidence: [
        'server/modules/ai/policy.ts',
        'server/services/coreAiGatewayService.ts (parse/normalize)',
        'server/services/ragSearchService.ts (system instruction + citations)',
      ],
    },
  ];

  const summary = items.reduce(
    (acc, item) => {
      if (item.status === 'DONE') acc.done += 1;
      else if (item.status === 'PARTIAL') acc.partial += 1;
      else acc.missing += 1;
      return acc;
    },
    { done: 0, partial: 0, missing: 0 },
  );

  const ok = items.every((i) => statusScore(i.status) === 2) && registryOk && separationOk;
  return {
    ok,
    checkedAt: new Date().toISOString(),
    summary,
    items,
    integrations: INTEGRATION_REGISTRY,
    scope: MIGRATION_SCOPE,
    coreModel: coreModelManifest,
  };
}
