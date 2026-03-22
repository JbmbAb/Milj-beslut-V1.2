import type { WeatherRisk } from "../types";

export async function fetchSmhiWeatherRisk(input: {
  lat: number;
  lng: number;
  municipality?: string;
}): Promise<WeatherRisk> {
  const params = new URLSearchParams({
    lat: String(input.lat),
    lng: String(input.lng),
  });
  if (input.municipality?.trim()) {
    params.set("municipality", input.municipality.trim());
  }

  const response = await fetch(`/api/weather/smhi-risk?${params.toString()}`);
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: WeatherRisk; error?: string }
    | null;

  if (!response.ok || !payload?.ok || !payload.result) {
    throw new Error(payload?.error || `SMHI weather request failed (${response.status})`);
  }

  return payload.result;
}
