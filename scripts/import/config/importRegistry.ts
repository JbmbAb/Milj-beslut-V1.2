export interface TargetConfig {
  target_schema: string;
  target_table: string;
}

export const IMPORT_REGISTRY: Record<string, Record<string, TargetConfig>> = {
  Lantmateriet: {
    'Fastighetsindelning/Registerenhetsomradesytor': {
      target_schema: 'env',
      target_table: 'registerenhetsomradesytor',
    },
    'Fastighetsindelning/Registerenhetsomradeslinjer': {
      target_schema: 'env',
      target_table: 'registerenhetsomradeslinjer',
    },
  },
  Naturvardsverket: {
    'SkyddadeOmraden/Naturreservat': {
      target_schema: 'env',
      target_table: 'protected_area',
    },
    'Natura2000/Omrade': {
      target_schema: 'env',
      target_table: 'natura2000_area',
    },
    'Vatten/Vattenskyddsomrade': {
      target_schema: 'env',
      target_table: 'water_protection_area',
    },
  },
  SGU: {
    Brunnar: { target_schema: 'env', target_table: 'sgu_well' },
    Jordarter25k100k: { target_schema: 'env', target_table: 'sgu_soil_type_25k_100k' },
    Jorddjup10m: { target_schema: 'env', target_table: 'sgu_jorddjupsmodell_10m' },
    JorddjupBergyta50m: { target_schema: 'env', target_table: 'sgu_jorddjupsmodell_bergyta_50m' },
    Fastmark: { target_schema: 'env', target_table: 'sgu_fastmark_stabilitet' },
    Grundvatten: { target_schema: 'env', target_table: 'env_sgu_grundvatten_sarbarhet' },
    Jordskred: { target_schema: 'env', target_table: 'sgu_landslide_feature' },
    AktsamhetEfterarbetad: { target_schema: 'env', target_table: 'sgu_aktsamhet_efterarbetad' },
  },
  MSB: {
    PFRA_PastEvent: { target_schema: 'env', target_table: 'msb_pfra_pastevent' },
    StoraOlyckor: { target_schema: 'env', target_table: 'msb_stora_olyckor' },
    Stabilitetszon: { target_schema: 'env', target_table: 'msb_stabilitetszon' },
    FloodRisk: { target_schema: 'climate', target_table: 'flood_risk_area' },
  },
  legacy_adopted: {
    'InspireMSB_PFRA_PastEvent': { target_schema: 'env', target_table: 'msb_pfra_pastevent' },
    'InspireMSB_StoraOlyckor': { target_schema: 'env', target_table: 'msb_stora_olyckor' },
    'jorddjupsmodell_10x10m': { target_schema: 'env', target_table: 'sgu_jorddjupsmodell_10m' },
    'jorddjupsmodell_bergyta_hojd_50x50m': { target_schema: 'env', target_table: 'sgu_jorddjupsmodell_bergyta_50m' },
    'SVARO_2016': { target_schema: 'env', target_table: 'svaro_2016' },
    'vm.VISS_SW_VARO_2016_1_RISK_TOTALT': { target_schema: 'env', target_table: 'viss_sw_varo_risk' },
  },
};

/**
 * Slår upp target config utifrån provider och dataset name.
 * Kastar ett fel om datasetet inte är registrerat, vilket skyddar mot okända manifests.
 */
export function getTargetConfig(provider: string, dataset: string): TargetConfig {
  const providerConfigs = IMPORT_REGISTRY[provider];
  if (!providerConfigs) {
    throw new Error(`Provider "${provider}" is not registered in Import Registry.`);
  }

  let config = providerConfigs[dataset];

  // Dynamisk fallback för legacy luftkvalitetsdata (förhindrar att vi måste registrera 50+ årtal manuellt)
  if (!config && provider === 'legacy_adopted') {
    if (dataset.startsWith('Gbg_NO2_Total_')) {
      config = { target_schema: 'env', target_table: `gbg_no2_total_${dataset.split('_').pop()}` };
    } else if (dataset.startsWith('Gbg_NOx_total_')) {
      config = { target_schema: 'env', target_table: `gbg_nox_total_${dataset.split('_').pop()}` };
    } else if (dataset.startsWith('Gbg_PM10_total_')) {
      config = { target_schema: 'env', target_table: `gbg_pm10_total_${dataset.split('_').pop()}` };
    }
  }

  if (!config) {
    throw new Error(`Dataset "${dataset}" for provider "${provider}" is not registered in Import Registry.`);
  }

  return config;
}
