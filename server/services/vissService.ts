/**
 * vissService.ts
 *
 * Integration mot VISS (Vatteninformationssystem Sverige) – Länsstyrelsernas databas
 * för vattenförekomster, ekologisk/kemisk status och miljökvalitetsnormer (MKN).
 *
 * API-dokumentation: https://viss.lansstyrelsen.se/api/swagger
 * Basformat: https://viss.lansstyrelsen.se/api?method=<tjänst>&apikey=<key>&format=json&<params>
 *
 * Konfiguration (.env):
 *   VISS_API_KEY = din personliga VISS API-nyckel
 */

import { logger } from '../logger';

// ─── Konstanter ──────────────────────────────────────────────────────────────

const VISS_BASE_URL = 'https://viss.lansstyrelsen.se/api';
const VISS_API_KEY = process.env.VISS_API_KEY ?? '';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min – VISS cachas av API:t självt

// ─── Typer – baserat på faktisk VISS API-respons ─────────────────────────────

/** Vattenkategori: RW=vattendrag, LW=sjö, TW=kust, CW=övergångsvatten, GW=grundvatten */
export type VissWaterCategory = 'RW' | 'LW' | 'TW' | 'CW' | 'GW';

/** Vattenförekomst från VISS NearbyWaters eller SubBasinWater */
export interface VissWater {
  Name: string;
  SwedishName?: string;
  EU_CD: string;
  MS_CD: string;
  WaterCategory: VissWaterCategory;
  /** VISS-länk till vattenförekomstens sida */
  URL?: string;
  Municipalites?: Array<{
    MunicipalityCode: string;
    MunicipalityName: string;
    CountyCode: string;
    CountyName: string;
  }>;
  ResponsibleCountyCode?: string;
  ResponsibleCountyName?: string;
  BasinEUID?: string;
  BasinName?: string;
}

/** Svar från coordinateinfo-metoden */
export interface VissCoordinateInfo {
  GivenCoordinate: { XValue: string; YValue: string; Format: string };
  NearbyWaters: VissWater[];
  MunicipalityCode: string | null;
  MunicipalityName: string | null;
  CountyCode: string | null;
  CountyName: string | null;
  SubBasinEUID: string | null;
  SubBasinName: string | null;
  BasinEUID: string | null;
  BasinName: string | null;
  AreaEUID: string | null;
  AreaName: string | null;
  SubBasinWater: VissWater | null;
}

/** Klassning för ett vatten (ekologisk/kemisk status) – från Motivations[]-arrayen */
export interface VissClassification {
  ParameterIdentifier: number;
  Parameter: string;
  ParameterSwedishName: string;
  Classification: string;
  ClassificationSwedishName: string;
  ClassificationIdentifier?: number;
  Motivation?: string;
  Date?: string;
  ColorCode?: string;
  ImpactTypes?: string[];
}

/** Wrapper-svar från latestwaterclassificationmotivations */
interface VissClassificationWrapper {
  EU_CD?: string;
  MS_CD?: string;
  Name?: string;
  WaterCategory?: string;
  Motivations?: VissClassification[];
}


export interface VissWaterStatus {
  waterId: string;
  waterName: string;
  /** Ekologisk status/potential, t.ex. "God", "Måttlig" */
  ecologicalStatus?: string;
  /** Kemisk status, t.ex. "God kemisk status" */
  chemicalStatus?: string;
  /** MKN-sammanfattning för juridisk bedömning */
  mknSummary?: string;
  classifications: VissClassification[];
}

/** Resultat från queryVissPoint */
export interface VissPointResult {
  ok: true;
  lat: number;
  lng: number;
  /** Närmaste vattenförekomster inom angiven radius */
  nearbyWaters: VissWater[];
  /** Närmast liggande delavrinningsområdesvatten */
  subBasinWater: VissWater | null;
  /** Kommuntillhörighet för koordinaten */
  municipalityCode: string | null;
  municipalityName: string | null;
  countyName: string | null;
  /** Avrinningsområde */
  basinName: string | null;
  /** Vattendistrikt */
  areaName: string | null;
  /** Status för närmaste vattenförekomst */
  primaryWaterStatus?: VissWaterStatus;
}

export interface VissPointError {
  ok: false;
  error: string;
}

// ─── Intern cache ─────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data as T;
  }
  return null;
}

function setCached(key: string, data: unknown): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Intern hjälpfunktion – API-anrop ─────────────────────────────────────────

async function vissRequest<T>(method: string, params: Record<string, string>): Promise<T> {
  if (!VISS_API_KEY) {
    throw new Error('VISS_API_KEY saknas i .env');
  }

  const searchParams = new URLSearchParams({
    method,
    apikey: VISS_API_KEY,
    format: 'json',
    ...params,
  });

  const url = `${VISS_BASE_URL}?${searchParams.toString()}`;
  const cacheKey = url;

  const cached = getCached<T>(cacheKey);
  if (cached !== null) return cached;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`VISS API fel: HTTP ${res.status} för metod "${method}"`);
  }

  const data = (await res.json()) as T;
  setCached(cacheKey, data);
  return data;
}

// ─── Exporterade funktioner ───────────────────────────────────────────────────

/**
 * Hämtar ytvattenförekomster i en given kommun.
 * Praktisk start – kommuner är stabila och VISS-data är kommunindelat.
 */
export async function getWatersByMunicipality(
  municipalityCode: string,
  category?: VissWaterCategory,
): Promise<VissWater[]> {
  const params: Record<string, string> = { municipalitycode: municipalityCode };
  if (category) params['watercategory'] = category;

  try {
    const result = await vissRequest<VissWater[]>('waters', params);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    logger.error('VISS getWatersByMunicipality fel', { municipalityCode, err: String(err) });
    return [];
  }
}

/**
 * Hämtar vattenförekomst-detaljer via VISS MS_CD eller EU_CD.
 */
export async function getWaterById(waterId: string): Promise<VissWater | null> {
  try {
    const result = await vissRequest<VissWater[]>('waters', { waterpublicid: waterId });
    return Array.isArray(result) && result.length > 0 ? result[0] : null;
  } catch (err) {
    logger.error('VISS getWaterById fel', { waterId, err: String(err) });
    return null;
  }
}

/**
 * Hämtar senaste klassning (ekologisk + kemisk status) för ett vatten.
 * API:t returnerar ett wrapper-objekt med Motivations[]-array.
 */
export async function getWaterClassifications(waterId: string): Promise<VissClassification[]> {
  try {
    const result = await vissRequest<VissClassificationWrapper>(
      'latestwaterclassificationmotivations',
      { waterpublicid: waterId },
    );
    return Array.isArray(result?.Motivations) ? result.Motivations : [];
  } catch (err) {
    logger.error('VISS getWaterClassifications fel', { waterId, err: String(err) });
    return [];
  }
}

/**
 * Sammanställer vattnets status (ekologisk + kemisk) i ett strukturerat objekt.
 */
export async function getWaterStatus(waterId: string): Promise<VissWaterStatus | null> {
  const [water, classifications] = await Promise.all([
    getWaterById(waterId),
    getWaterClassifications(waterId),
  ]);

  if (!water && classifications.length === 0) return null;

  const waterName = water?.Name ?? waterId;
  const ecoClass = classifications.find(
    (c) => c.Parameter === 'ECO_STAT' || c.Parameter === 'ECO_POT',
  );
  const chemClass = classifications.find((c) => c.Parameter === 'CHEM_STAT');

  return {
    waterId,
    waterName,
    ecologicalStatus: ecoClass?.ClassificationSwedishName,
    chemicalStatus: chemClass?.ClassificationSwedishName,
    mknSummary: buildMknSummary(ecoClass, chemClass),
    classifications,
  };
}

/**
 * Hämtar information om vattenförekomster nära en koordinat (lat/lng WGS84).
 * OBS: VISS coordinateinfo använder x=lat, y=lng (omvänt GIS-konvention).
 *
 * @param radiusMeters  Sökradius i meter (standard 2000m)
 */
export async function queryVissPoint(
  lat: number,
  lng: number,
  radiusMeters = 2000,
): Promise<VissPointResult | VissPointError> {
  try {
    // VISS: x=lat (northing), y=lng (easting) – omvänd konvention!
    const coordInfo = await vissRequest<VissCoordinateInfo>('coordinateinfo', {
      x: String(lat),
      y: String(lng),
      coordinateformat: 'WGS84',
      radius: String(radiusMeters),
    });

    const nearbyWaters = Array.isArray(coordInfo.NearbyWaters) ? coordInfo.NearbyWaters : [];

    // Hämta status för närmaste vattenförekomst (om finns)
    let primaryWaterStatus: VissWaterStatus | undefined;
    const primaryWater = coordInfo.SubBasinWater ?? nearbyWaters[0];
    if (primaryWater?.MS_CD) {
      const status = await getWaterStatus(primaryWater.MS_CD);
      if (status) primaryWaterStatus = status;
    }

    return {
      ok: true,
      lat,
      lng,
      nearbyWaters,
      subBasinWater: coordInfo.SubBasinWater,
      municipalityCode: coordInfo.MunicipalityCode,
      municipalityName: coordInfo.MunicipalityName,
      countyName: coordInfo.CountyName,
      basinName: coordInfo.BasinName,
      areaName: coordInfo.AreaName,
      primaryWaterStatus,
    };
  } catch (err) {
    logger.error('VISS queryVissPoint fel', { lat, lng, err: String(err) });
    return { ok: false, error: String(err) };
  }
}

/**
 * Hälsokontroll: verifierar att API-nyckeln fungerar och VISS svarar.
 */
export async function checkVissHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!VISS_API_KEY) {
    return { ok: false, error: 'VISS_API_KEY saknas i .env' };
  }

  try {
    // Anrop med minimal belastning: hämta vattenkategorier (statisk lista)
    const result = await vissRequest<unknown[]>('watercategories', {});
    if (Array.isArray(result) && result.length > 0) {
      return { ok: true };
    }
    return { ok: false, error: 'Oväntat tomt svar från VISS watercategories' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Intern hjälpfunktion ────────────────────────────────────────────────────

function buildMknSummary(
  ecoClass?: VissClassification,
  chemClass?: VissClassification,
): string | undefined {
  const parts: string[] = [];
  if (ecoClass?.ClassificationSwedishName) {
    parts.push(`Ekologisk status: ${ecoClass.ClassificationSwedishName}`);
  }
  if (chemClass?.ClassificationSwedishName) {
    parts.push(`Kemisk status: ${chemClass.ClassificationSwedishName}`);
  }
  return parts.length > 0 ? parts.join(' | ') : undefined;
}
