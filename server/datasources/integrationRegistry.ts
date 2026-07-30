/**
 * integrationRegistry.ts
 *
 * Kodifierad karta över alla externa beroenden.
 * Används för migreringsberedskap (scope, licens, auth, fallback) och drift.
 */

export type IntegrationAuth =
  | { kind: 'none' }
  | { kind: 'api_key'; env: string }
  | { kind: 'subscription_key'; env: string }
  | { kind: 'oauth2_client_credentials'; envClientId: string; envClientSecret: string; envTokenUrl?: string };

export type IntegrationSurface = 'GIS' | 'PROPERTY_LOOKUP' | 'RAG' | 'AI' | 'INGEST' | 'DOCS' | 'OTHER';
export type IntegrationRunMode = 'RUNTIME' | 'BULK_ETL' | 'BOTH';
export type IntegrationFailureClass = 'BLOCKING' | 'DEGRADABLE';

export interface IntegrationDependency {
  id: string;
  provider: string;
  surface: IntegrationSurface;
  description: string;
  baseUrls: string[];
  auth: IntegrationAuth;
  license: string;
  fallbackStrategy: string;
  runMode: IntegrationRunMode;
  /** Dokumenterad cache-policy (none / ttl / db-cache / edge-cache). */
  cachePolicy: string;
  /** Kvot/ratelimit (om okänt: skriv "unknown" men fyll i). */
  rateLimits: string;
  /** Om fel i integrationen ska blockera kärnflödet eller bara degradera UI. */
  failureClass: IntegrationFailureClass;
  /** Om audit krävs vid anrop eller state change. */
  auditRequired: boolean;
}

export const INTEGRATION_REGISTRY: readonly IntegrationDependency[] = [
  {
    id: 'lantmateriet_open_ogc',
    provider: 'Lantmäteriet',
    surface: 'PROPERTY_LOOKUP',
    description:
      'Harvest/import only: OGC API Features → Mimers Brunn-arkiv → PostGIS. UI-runtime använder aldrig api.lantmateriet.se.',
    baseUrls: ['https://api.lantmateriet.se/ogc-features/v1'],
    auth: { kind: 'subscription_key', env: 'LANTMATERIET_OPEN_SUBSCRIPTION_KEY' },
    license: 'CC-BY (ange © Lantmäteriet vid attribution; data ursprungligen från Lantmäteriet)',
    fallbackStrategy: 'UI: endast PostGIS (core.property_unit). Live LM avvisas (503).',
    runMode: 'BULK_ETL',
    cachePolicy: 'PostGIS är källan för UI; LM-API endast vid skörd',
    rateLimits: 'unknown (se API-portalen för prenumeration)',
    failureClass: 'DEGRADABLE',
    auditRequired: true,
  },
  {
    id: 'lantmateriet_open_wms_wmts',
    provider: 'Lantmäteriet',
    surface: 'GIS',
    description:
      'Harvest/import only: Topo/Ortofoto WMS/WMTS för arkiv/raster. Hub-UI använder OSM eller VITE_LOCAL_BASEMAP_* — ingen LM-nyckel i Vite-klienten.',
    baseUrls: ['https://api.lantmateriet.se/open/'],
    auth: { kind: 'subscription_key', env: 'LANTMATERIET_OPEN_SUBSCRIPTION_KEY' },
    license: 'CC-BY (ange © Lantmäteriet vid attribution)',
    fallbackStrategy: 'UI-basemap: OSM (default) eller lokal XYZ/WMS via VITE_LOCAL_BASEMAP_*',
    runMode: 'BULK_ETL',
    cachePolicy: 'Master Archive / lokala tiles; inte browser→LM i runtime',
    rateLimits: 'unknown',
    failureClass: 'DEGRADABLE',
    auditRequired: false,
  },
  {
    id: 'sgu_wms',
    provider: 'SGU',
    surface: 'GIS',
    description: 'Publika WMS-lager (brunnar, grundvattensårbarhet).',
    baseUrls: ['https://maps3.sgu.se/geoserver/'],
    auth: { kind: 'none' },
    license: 'SGU öppna data (se SGU villkor)',
    fallbackStrategy: 'Om WMS faller: fortsätt utan overlay',
    runMode: 'RUNTIME',
    cachePolicy: 'browser/leaflet cache only',
    rateLimits: 'unknown',
    failureClass: 'DEGRADABLE',
    auditRequired: false,
  },
  {
    id: 'raa_wms_wfs',
    provider: 'Riksantikvarieämbetet',
    surface: 'GIS',
    description: 'Fornlämningar via publika WMS/WFS.',
    baseUrls: ['https://pub.raa.se/visning/'],
    auth: { kind: 'none' },
    license: 'RAÄ öppna data (se villkor)',
    fallbackStrategy: 'Om WMS/WFS faller: fortsätt utan overlay',
    runMode: 'RUNTIME',
    cachePolicy: 'none',
    rateLimits: 'unknown',
    failureClass: 'DEGRADABLE',
    auditRequired: false,
  },
  {
    id: 'vertex_ai',
    provider: 'Google Cloud Vertex AI',
    surface: 'AI',
    description: 'All generativ AI körs via Vertex AI (Gemini-modeller).',
    baseUrls: ['https://europe-west1-aiplatform.googleapis.com'],
    auth: { kind: 'api_key', env: 'GOOGLE_APPLICATION_CREDENTIALS/ADC' },
    license: 'GCP-avtal',
    fallbackStrategy: 'Fail-soft: returnera null/strukturfel och kräva manuell hantering',
    runMode: 'RUNTIME',
    cachePolicy: 'none',
    rateLimits: 'GCP quota (project-level)',
    failureClass: 'DEGRADABLE',
    auditRequired: true,
  },
];
