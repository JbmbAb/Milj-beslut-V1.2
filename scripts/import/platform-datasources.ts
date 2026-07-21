/**
 * Canonical list of all external OGC/WFS data sources for the platform.
 * This file serves as the single source of truth for bulk imports.
 *
 * Each entry defines:
 * - id: A unique identifier for the data source.
 * - url: (Optional) The base URL for the OGC API Features or WFS service.
 * - filePath: (Optional) The local path to a file (e.g., Shapefile, GeoPackage).
 * - layerName: (Optional) The specific layer to import from a file source.
 * - table: The target table in the database (including schema).
 * - auth: (Optional) Specifies if authentication is needed (e.g., 'lm' for Lantmäteriet).
 * - type: The type of service, defaults to 'OAPIF' (OGC API Features). Can be 'WFS'.
 * - featureType: (Optional) The specific feature type to request for WFS services.
 */
export const PLATFORM_COLLECTIONS = [
  // SGU - Geologi & Risker (OGC API Features)
  {
    id: 'sgu_ground_1m' as const,
    url: 'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager',
    table: 'env.sgu_ground_layer_1m',
  },
  {
    id: 'sgu_landslide' as const,
    url: 'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner',
    table: 'env.sgu_landslide_feature',
  },
  {
    id: 'sgu_soil_25k_100k' as const,
    url: 'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager',
    table: 'env.sgu_soil_type_25k_100k',
  },
  {
    id: 'sgu_groundwater' as const,
    url: 'https://api.sgu.se/oppnadata/grundvattenmagasin/ogc/features/v1/collections/grundvattenmagasin',
    table: 'env.env_sgu_grundvatten_sarbarhet',
  },
  {
    id: 'sgu_wells' as const,
    url: 'https://api.sgu.se/oppnadata/brunnar/ogc/features/v1/collections/brunnar',
    table: 'env.sgu_well',
  },
  {
    id: 'sgu_aktsam_efterarbetad' as const,
    url: 'https://api.sgu.se/oppnadata/forutsattningar-skred-finkornig-jordart/ogc/features/v1/collections/aktsam-efterarbetad',
    table: 'env.sgu_aktsamhet_efterarbetad',
  },
  {
    id: 'sgu_erosion_aktiv' as const,
    url: 'https://api.sgu.se/oppnadata/stranderosion-kust/ogc/features/v1/collections/aktiv-erosion',
    table: 'env.sgu_erosion_aktiv',
  },
  {
    id: 'sgu_fastmark' as const,
    url: 'https://api.sgu.se/oppnadata/fastmark/ogc/features/v1/collections/fastmark',
    table: 'env.sgu_fastmark_stabilitet',
    disabled: true, // Temporarily disabled: intermittent lock/stall behavior during imported-run validation.
  },

  // LANTMÄTERIET - Fastigheter & Topografi (OGC API Features)
  {
    id: 'lm_fastighetsytor' as const,
    url: 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradesytor',
    table: 'env.registerenhetsomradesytor',
    auth: 'lm',
  },
  {
    id: 'lm_fastighetslinjer' as const,
    url: 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradeslinjer',
    table: 'env.registerenhetsomradeslinjer',
    auth: 'lm',
    disabled: true, // Endpoint currently returning 404 in ingestion runtime.
  },
  {
    id: 'lm_topo_mark' as const,
    url: 'https://api.lantmateriet.se/ogc-features/v1/topografi/collections/mark',
    filePath:
      'C:\\Millbygard_from_D\\Millbygård\\data\\topografi\\orsa_stackmora_3_12_topografi_mark_2km_3006.gpkg',
    table: 'core.lm_mark',
    auth: 'lm',
    disabled: true, // Endpoint currently returning 404 in ingestion runtime.
  },
  {
    id: 'lm_topo_byggnad' as const,
    url: 'https://api.lantmateriet.se/ogc-features/v1/topografi/collections/byggnad',
    filePath:
      'C:\\Millbygard_from_D\\Millbygård\\data\\topografi\\orsa_stackmora_3_12_topografi_byggnadsverk_2km_3006.gpkg',
    table: 'core.lm_byggnad',
    auth: 'lm',
    disabled: true, // Endpoint currently returning 404 in ingestion runtime.
  },
  {
    id: 'lm_topo_vatten' as const,
    url: 'https://api.lantmateriet.se/ogc-features/v1/topografi/collections/vattenytor',
    filePath:
      'C:\\Millbygard_from_D\\Millbygård\\data\\topografi\\orsa_stackmora_3_12_topografi_hydrografi_2km_3006.gpkg',
    table: 'topo10.vatten',
    auth: 'lm',
    disabled: true, // Endpoint currently returning 404 in ingestion runtime.
  },

  // NATURVÅRDSVERKET - Skyddad natur (OGC API Features via Geodata.se)
  // Uppdaterad URL 2025 – gamla Metria WFS-tjänsten är nedlagd
  {
    id: 'nv_skyddad_natur' as const,
    url: 'https://geodata.naturvardsverket.se/naturvardsverket/ogc/features/v1/collections/skyddade_omraden',
    table: 'env.nv_skyddad_natur',
    disabled: true, // OAPIF URL responds with service-not-found HTML.
  },

  // RIKSANTIKVARIEÄMBETET - Fornlämningar (OGC API Features via SOCH)
  // Uppdaterad URL 2025 – gamla WFS karta.raa.se/geo är nedlagd
  {
    id: 'raa_fornlamningar' as const,
    url: 'https://api.raa.se/fornsok/v2/ogcapi/collections/fornlamning',
    table: 'env.raa_fornlamning',
    disabled: true, // DNS resolution failed repeatedly in ingestion runtime.
  },

  // LÄNSSTYRELSERNA - Vattenskyddsområden & Miljöfarlig verksamhet
  {
    id: 'lst_vattenskydd' as const,
    url: 'https://ext-geodata.lansstyrelsen.se/arcgis/services/WFS/LST_WFS_Riks/MapServer/WFSServer',
    table: 'env.lst_vattenskyddsomrade',
    type: 'WFS',
    featureType: 'Vattenskyddsområden',
    disabled: true, // Endpoint timed out repeatedly during retries.
  },
  {
    id: 'lst_miljofarlig_verksamhet' as const,
    url: 'https://ext-geodata.lansstyrelsen.se/geoserver/ows',
    table: 'env.lst_miljofarlig_verksamhet',
    type: 'WFS',
    featureType: 'lst:miljofarlig_verksamhet',
    disabled: true, // Endpoint timed out repeatedly during retries.
  },

  // VISS & SMED - Vattenstatus och Miljöbelastning
  {
    id: 'viss_vattenforekomster' as const,
    url: 'https://ext-geodata.lansstyrelsen.se/viss/wfs',
    table: 'env.viss_vattenforekomst',
    type: 'WFS',
    featureType: 'ms:viss_vattendirektivet_ytvatten',
    disabled: true, // Endpoint timed out repeatedly during retries.
  },
  {
    id: 'smed_belastning_vatten' as const,
    url: 'https://ext-geodata.lansstyrelsen.se/viss/wfs',
    table: 'env.smed_belastning_vatten',
    type: 'WFS',
    featureType: 'ms:viss_belastning_totp_totn',
    disabled: true, // Endpoint timed out repeatedly during retries.
  },
  {
    id: 'smed_utslapp_luft' as const,
    url: 'https://api.smhi.se/emissions/ogc/features/v1/collections/emissions_grid_1km',
    table: 'env.smed_utslapp_luft',
    type: 'OAPIF',
    disabled: true, // DNS resolution failed repeatedly in ingestion runtime.
  },

  // SMHI SVAR 2022 – huvudavrinningsområden (111 polygoner, WFS 2.0)
  {
    id: 'smhi_huvudavrinningsomraden' as const,
    url: 'https://opendata-view.smhi.se/SMHI_vatten_RiverBasin/HY.PhysicalWaters.Catchments/wfs',
    table: 'hydro.huvudavrinningsomraden',
    type: 'WFS',
    featureType: 'SMHI_vatten_RiverBasin:HY.PhysicalWaters.Catchments',
  },

  // SLU & SKOGSSTYRELSEN - Biologisk mångfald & Artskydd
  {
    id: 'slu_artobservationer' as const,
    url: 'https://sosgeo.artdata.slu.se/geoserver/SOS/ows',
    table: 'env.slu_species_observation',
    type: 'WFS',
    featureType: 'SOS:SpeciesObservations',
    disabled: true, // Endpoint returns WFS 400 for current request shape.
  },
  {
    id: 'skogsstyrelsen_nyckelbiotoper' as const,
    url: 'https://wfs.skogsstyrelsen.se/arcgis/services/Nyckelbiotoper/MapServer/WFSServer',
    table: 'env.skogsstyrelsen_key_habitat',
    type: 'WFS',
    featureType: 'Nyckelbiotoper',
    disabled: true, // DNS resolution failed repeatedly in ingestion runtime.
  },
  {
    id: 'skogsstyrelsen_naturvarden' as const,
    url: 'https://wfs.skogsstyrelsen.se/arcgis/services/ObjektNaturvarde/MapServer/WFSServer',
    table: 'env.skogsstyrelsen_nature_value',
    type: 'WFS',
    featureType: 'ObjektNaturvarde',
    disabled: true, // DNS resolution failed repeatedly in ingestion runtime.
  },
];
