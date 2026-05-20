/**
 * migration scope
 *
 * Kodifierar vad som "ingår" i migreringen (och vad som inte gör det) så att
 * teamet inte råkar prioritera fel datakälla (bulk vs live, open vs betalt).
 */

export type MigrationSurface = 'DOMAIN' | 'GIS' | 'AI' | 'RAG' | 'INGEST' | 'AUTH' | 'POSTGIS';

export interface MigrationScopeItem {
  id: string;
  surface: MigrationSurface;
  inScope: boolean;
  description: string;
  evidence: string[];
}

export const MIGRATION_SCOPE: readonly MigrationScopeItem[] = [
  {
    id: 'domain_prisma_models',
    surface: 'DOMAIN',
    inScope: true,
    description: 'Prisma-managed domänmodeller (Project, Requirement*, Documents, submissions etc.)',
    evidence: ['prisma/schema.prisma'],
  },
  {
    id: 'postgis_env_schema',
    surface: 'POSTGIS',
    inScope: true,
    description: 'SQL-managed PostGIS-tabeller i env.* (spatial screening/kartlager).',
    evidence: ['prisma/schema.prisma header', 'prisma/spatial/*', 'server/services/publicUiService.ts'],
  },
  {
    id: 'open_gis_basemap',
    surface: 'GIS',
    inScope: true,
    description: 'Interaktiv karta + kartlager endpoints (/api/layers/*).',
    evidence: [
      'components/MapView.tsx',
      'server/routes/gis.routes.ts',
      'server/datasources/mapLayerCatalog.ts',
    ],
  },
  {
    id: 'property_lookup',
    surface: 'DOMAIN',
    inScope: true,
    description: 'Fastighetsuppslag med prioritering PostGIS → open OGC → OAuth (om aktiverat).',
    evidence: ['server/services/lantmaterietService.ts', 'server/routes/property.routes.ts'],
  },
  {
    id: 'bulk_download_stac_atom',
    surface: 'INGEST',
    inScope: false,
    description:
      'Bulk-nedladdning (STAC/Atom/Geotorget) ingår inte i runtime-migrering av UI. Hanteras som separat ETL.',
    evidence: ['docs/integrations/lantmateriet.md'],
  },
  {
    id: 'ai_vertex_gateway',
    surface: 'AI',
    inScope: true,
    description: 'AI via Vertex AI med fail-soft och parsers.',
    evidence: ['server/services/vertexAiService.ts', 'server/services/coreAiGatewayService.ts'],
  },
  {
    id: 'rag_search',
    surface: 'RAG',
    inScope: true,
    description: 'RAG-sök med källor (chunks + knowledge graph).',
    evidence: ['server/services/ragSearchService.ts', 'server/services/knowledgeGraphService.ts'],
  },
];
