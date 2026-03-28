import { logger } from "../logger";

const SMHI_PMP3G_BASE_URL =
  (process.env.SMHI_PMP3G_BASE_URL ||
    "https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point").replace(/\/+$/, "");
const CACHE_TTL_MS = 10 * 60 * 1000;
const FORECAST_WINDOW_HOURS = 12;

type RiskLevel = "Låg" | "Medel" | "Hög";
type ParameterName = "t" | "ws" | "gust" | "pmean" | "pmax" | "tstm" | "Wsymb2";

interface SmhiParameter {
  name?: string;
  values?: number[];
}

interface SmhiTimeSeriesEntry {
  validTime?: string;
  parameters?: SmhiParameter[];
}

interface SmhiPointForecastResponse {
  approvedTime?: string;
  referenceTime?: string;
  timeSeries?: SmhiTimeSeriesEntry[];
}

export interface SmhiWeatherRiskSummary {
  airTemperatureC: number | null;
  windSpeedMs: number | null;
  gustMs: number | null;
  precipitationMmPerHour: number | null;
  thunderstormRiskPct: number | null;
  symbolCode: number | null;
}

export interface SmhiWeatherRiskTimelinePoint extends SmhiWeatherRiskSummary {
  validTime: string;
}

export interface SmhiWeatherRiskResult {
  level: RiskLevel;
  description: string;
  action: string;
  source: "smhi_pmp3g";
  fetchedAt: string;
  approvedTime: string | null;
  referenceTime: string | null;
  municipality?: string;
  coordinates: { lat: number; lng: number };
  forecastWindowHours: number;
  summary: SmhiWeatherRiskSummary;
  peaks: {
    maxWindMs: number | null;
    maxGustMs: number | null;
    maxPrecipitationMmPerHour: number | null;
    accumulatedPrecipitationMm: number | null;
    maxThunderstormRiskPct: number | null;
  };
  timeline: SmhiWeatherRiskTimelinePoint[];
}

const cache = new Map<string, { expiresAt: number; value: SmhiWeatherRiskResult }>();

function roundMetric(value: number | null, digits = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function getParameter(entry: SmhiTimeSeriesEntry, name: ParameterName): number | null {
  const match = Array.isArray(entry.parameters) ? entry.parameters.find((parameter) => parameter.name === name) : undefined;
  const value = Array.isArray(match?.values) ? match.values[0] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildTimeline(entry: SmhiTimeSeriesEntry[]): SmhiWeatherRiskTimelinePoint[] {
  return entry
    .filter((item): item is SmhiTimeSeriesEntry & { validTime: string } => typeof item.validTime === "string" && item.validTime.length > 0)
    .slice(0, FORECAST_WINDOW_HOURS)
    .map((item) => ({
      validTime: item.validTime,
      airTemperatureC: roundMetric(getParameter(item, "t")),
      windSpeedMs: roundMetric(getParameter(item, "ws")),
      gustMs: roundMetric(getParameter(item, "gust")),
      precipitationMmPerHour: roundMetric(getParameter(item, "pmean")),
      thunderstormRiskPct: roundMetric(getParameter(item, "tstm")),
      symbolCode: roundMetric(getParameter(item, "Wsymb2"), 0),
    }));
}

function maxMetric(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return filtered.length > 0 ? Math.max(...filtered) : null;
}

function sumMetric(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (filtered.length === 0) return null;
  return filtered.reduce((sum, value) => sum + value, 0);
}

function buildDescription(params: {
  municipality?: string;
  summary: SmhiWeatherRiskSummary;
  accumulatedPrecipitationMm: number | null;
  maxGustMs: number | null;
  level: RiskLevel;
}): string {
  const place = params.municipality?.trim() ? `för ${params.municipality}` : "för vald plats";
  const fragments: string[] = [];

  if (params.summary.precipitationMmPerHour !== null) {
    fragments.push(`nederbörd nu ${params.summary.precipitationMmPerHour.toFixed(1)} mm/h`);
  }
  if (params.accumulatedPrecipitationMm !== null) {
    fragments.push(`ca ${params.accumulatedPrecipitationMm.toFixed(1)} mm kommande ${FORECAST_WINDOW_HOURS} h`);
  }
  if (params.maxGustMs !== null) {
    fragments.push(`vindbyar upp till ${params.maxGustMs.toFixed(1)} m/s`);
  }
  if (params.summary.thunderstormRiskPct !== null && params.summary.thunderstormRiskPct > 0) {
    fragments.push(`åskrisk ${params.summary.thunderstormRiskPct.toFixed(0)}%`);
  }

  const situation = fragments.length > 0 ? fragments.join(", ") : "begränsade prognosindikatorer";
  return `SMHI-prognosen ${place} visar ${situation}. Samlad väderrisk bedöms som ${params.level.toLowerCase()}.`;
}

function buildAction(level: RiskLevel): string {
  if (level === "Hög") {
    return "Säkra avvattning, erosionsskydd och täckning innan arbete startar. Lägg in tät väderuppföljning och beredskap för att pausa schakt.";
  }
  if (level === "Medel") {
    return "Följ nederbörd och vind under dagen, kontrollera pumpning och håll skyddsmaterial redo innan markarbete fortsätter.";
  }
  return "Normal arbetsberedning räcker oftast, men kontrollera SMHI igen före start och efter större väderomslag.";
}

export function summarizeSmhiForecast(
  forecast: SmhiPointForecastResponse,
  input: { lat: number; lng: number; municipality?: string }
): SmhiWeatherRiskResult {
  const timeline = buildTimeline(Array.isArray(forecast.timeSeries) ? forecast.timeSeries : []);
  if (timeline.length === 0) {
    throw new Error("SMHI forecast response did not contain any time series data");
  }

  const summary = timeline[0];
  const maxWindMs = roundMetric(maxMetric(timeline.map((item) => item.windSpeedMs)));
  const maxGustMs = roundMetric(maxMetric(timeline.map((item) => item.gustMs)));
  const maxPrecipitationMmPerHour = roundMetric(maxMetric(timeline.map((item) => item.precipitationMmPerHour)));
  const accumulatedPrecipitationMm = roundMetric(sumMetric(timeline.map((item) => item.precipitationMmPerHour)));
  const maxThunderstormRiskPct = roundMetric(maxMetric(timeline.map((item) => item.thunderstormRiskPct)));

  let level: RiskLevel = "Låg";
  if (
    (maxGustMs !== null && maxGustMs >= 18) ||
    (maxPrecipitationMmPerHour !== null && maxPrecipitationMmPerHour >= 2.5) ||
    (accumulatedPrecipitationMm !== null && accumulatedPrecipitationMm >= 8) ||
    (maxThunderstormRiskPct !== null && maxThunderstormRiskPct >= 35)
  ) {
    level = "Hög";
  } else if (
    (maxGustMs !== null && maxGustMs >= 12) ||
    (maxWindMs !== null && maxWindMs >= 9) ||
    (maxPrecipitationMmPerHour !== null && maxPrecipitationMmPerHour >= 1) ||
    (accumulatedPrecipitationMm !== null && accumulatedPrecipitationMm >= 3) ||
    (maxThunderstormRiskPct !== null && maxThunderstormRiskPct >= 15)
  ) {
    level = "Medel";
  }

  return {
    level,
    description: buildDescription({
      municipality: input.municipality,
      summary,
      accumulatedPrecipitationMm,
      maxGustMs,
      level,
    }),
    action: buildAction(level),
    source: "smhi_pmp3g",
    fetchedAt: new Date().toISOString(),
    approvedTime: forecast.approvedTime ?? null,
    referenceTime: forecast.referenceTime ?? null,
    municipality: input.municipality?.trim() || undefined,
    coordinates: {
      lat: roundMetric(input.lat, 5) ?? input.lat,
      lng: roundMetric(input.lng, 5) ?? input.lng,
    },
    forecastWindowHours: FORECAST_WINDOW_HOURS,
    summary,
    peaks: {
      maxWindMs,
      maxGustMs,
      maxPrecipitationMmPerHour,
      accumulatedPrecipitationMm,
      maxThunderstormRiskPct,
    },
    timeline,
  };
}

export function clearSmhiWeatherCache(): void {
  cache.clear();
}

export async function getSmhiWeatherRisk(input: {
  lat: number;
  lng: number;
  municipality?: string;
}): Promise<SmhiWeatherRiskResult> {
  const key = cacheKey(input.lat, input.lng);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const url = `${SMHI_PMP3G_BASE_URL}/lon/${encodeURIComponent(String(input.lng))}/lat/${encodeURIComponent(String(input.lat))}/data.json`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`SMHI weather request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SmhiPointForecastResponse;
  const result = summarizeSmhiForecast(payload, input);
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  logger.info("smhi-weather: fetched forecast", {
    lat: result.coordinates.lat,
    lng: result.coordinates.lng,
    level: result.level,
    source: result.source,
  });
  return result;
}
