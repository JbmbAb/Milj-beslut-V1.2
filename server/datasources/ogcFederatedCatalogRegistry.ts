/**
 * Samlade OGC-tjänster (WMS/WFS) med många underlager via GetCapabilities.
 * Kompletterar enskilda dataset-lager i platformMapLayerRegistry.
 */

export type OgcServiceType = 'WMS' | 'WFS';

export interface OgcFederatedCatalogDefinition {
  id: string;
  label: string;
  provider: string;
  service: OgcServiceType;
  /** Bas-URL till tjänsten (GetCapabilities utan query eller med ?) */
  baseUrl: string;
  version: string;
  description?: string;
}

export const OGC_FEDERATED_CATALOGS: OgcFederatedCatalogDefinition[] = [
  {
    id: 'lst_geoserver_wms',
    label: 'Länsstyrelsen GeoServer (WMS)',
    provider: 'Länsstyrelsen',
    service: 'WMS',
    baseUrl: 'https://ext-geodata.lansstyrelsen.se/geoserver/ows',
    version: '1.3.0',
    description: 'Flera regionala lager via en GeoServer WMS (GetCapabilities listar underlager).',
  },
  {
    id: 'lst_viss_wms',
    label: 'VISS / SMED (WMS)',
    provider: 'Länsstyrelsen / HaV',
    service: 'WMS',
    baseUrl: 'https://ext-geodata.lansstyrelsen.se/viss/wms',
    version: '1.3.0',
    description: 'Vattenförekomster och belastning m.m. via VISS WMS.',
  },
  {
    id: 'lst_wfs_riks',
    label: 'LST WFS Riks',
    provider: 'Länsstyrelsen',
    service: 'WFS',
    baseUrl: 'https://ext-geodata.lansstyrelsen.se/arcgis/services/WFS/LST_WFS_Riks/MapServer/WFSServer',
    version: '2.0.0',
    description: 'Nationell WFS med flera feature types (t.ex. vattenskydd). Importeras till PostGIS, inte som WMS-rutor.',
  },
  {
    id: 'lst_geoserver_wfs',
    label: 'Länsstyrelsen GeoServer (WFS)',
    provider: 'Länsstyrelsen',
    service: 'WFS',
    baseUrl: 'https://ext-geodata.lansstyrelsen.se/geoserver/ows',
    version: '2.0.0',
    description: 'Samma GeoServer som WMS – feature types för vektorimport.',
  },
];

const catalogById = new Map(OGC_FEDERATED_CATALOGS.map((c) => [c.id, c]));

export function findOgcFederatedCatalog(id: string): OgcFederatedCatalogDefinition | undefined {
  return catalogById.get(id);
}

export function listOgcFederatedCatalogs(): OgcFederatedCatalogDefinition[] {
  return [...OGC_FEDERATED_CATALOGS];
}
