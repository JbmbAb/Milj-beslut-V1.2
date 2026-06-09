/**
 * Officiella referenser för nationella åtgärdsunderlag och miljödata.
 */

/** Vattenmyndigheternas huvudsida för åtgärdsunderlag */
export const VATTENMYNDIGHETERNA_ATGARDSUNDERLAG_URL =
  'https://www.vattenmyndigheterna.se/stod-i-arbetet/digitala-atgardsunderlag.html';

/** Länsstyrelsernas Storymap-samling för digitala åtgärdsunderlag (Nationell) */
export const LST_STORYMAP_COLLECTION_URL =
  'https://ext-geoportal.lansstyrelsen.se/arcgis/apps/storymaps/collections/4b2c652f971e4618a8be3a6b0ea63158';

/** ArcGIS REST Services bas-URL för Vattenmyndigheternas åtgärdsunderlag */
export const LST_VM_REST_BASE_URL =
  'https://ext-geoportal.lansstyrelsen.se/arcgis/rest/services/Vattenmyndigheterna';

export const NATIONAL_ENVIRONMENTAL_LAYERS = [
  {
    key: 'lst_vm_avlopp',
    label: 'Åtgärdsunderlag: Avlopp',
    restUrl: `${LST_VM_REST_BASE_URL}/Avlopp/MapServer`,
    provider: 'Vattenmyndigheterna / Länsstyrelsen',
    description: 'Utsläppspunkter och belastning från enskilda och kommunala avlopp.',
  },
  {
    key: 'lst_vm_dagvatten',
    label: 'Åtgärdsunderlag: Dagvatten',
    restUrl: `${LST_VM_REST_BASE_URL}/Dagvatten/MapServer`,
    provider: 'Vattenmyndigheterna / Länsstyrelsen',
    description: 'GIS-data för avrinningsområden och recipientkänslighet vid dagvattenhantering.',
  },
  {
    key: 'lst_vm_fororenade_omraden',
    label: 'Åtgärdsunderlag: Förorenade områden',
    restUrl: `${LST_VM_REST_BASE_URL}/Fororenade_omraden/MapServer`,
    provider: 'Vattenmyndigheterna / Länsstyrelsen',
    description: 'Nationell data för riskklassade objekt (EBH) och påverkan på vatten.',
  },
  {
    key: 'lst_vm_fysisk_planering',
    label: 'Åtgärdsunderlag: Fysisk planering',
    restUrl: `${LST_VM_REST_BASE_URL}/Fysisk_planering/MapServer`,
    provider: 'Vattenmyndigheterna / Länsstyrelsen',
    description: 'Digitala underlag för miljökvalitetsnormer i kommunal planering.',
  },
];
