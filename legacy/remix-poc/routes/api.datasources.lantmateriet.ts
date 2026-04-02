import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

function readRequiredCredentials() {
  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET?.trim();

  if (!consumerKey || !consumerSecret) {
    throw new Error("Lantmateriet credentials saknas i miljo-variabler.");
  }

  return { consumerKey, consumerSecret };
}

function resolveBaseUrl(): string {
  return (process.env.LANTMATERIET_BASE_URL || "https://api.lantmateriet.se/ogc-features/v1").replace(/\/+$/, "");
}

function resolveTokenUrl(baseUrl: string): string {
  const configured = process.env.LANTMATERIET_TOKEN_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const url = new URL(baseUrl);
  return `${url.origin}/token`;
}

function resolveScope(baseUrl: string): string {
  const lookupMode = (process.env.LANTMATERIET_LOOKUP_MODE || "").trim().toLowerCase();
  const isOgc = lookupMode === "ogc" || baseUrl.toLowerCase().includes("/ogc-features/");
  return process.env.LANTMATERIET_SCOPE || (isOgc ? "ogc-features:fastighetsindelning.read" : "");
}

async function getAccessToken(baseUrl: string): Promise<{ accessToken: string; expiresIn: number }> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return {
      accessToken: tokenCache.accessToken,
      expiresIn: Math.max(0, Math.floor((tokenCache.expiresAt - Date.now()) / 1000)),
    };
  }

  const { consumerKey, consumerSecret } = readRequiredCredentials();
  const tokenUrl = resolveTokenUrl(baseUrl);
  const scope = resolveScope(baseUrl);
  const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const body = `grant_type=client_credentials${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authString}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Kunde inte hamta token fran Lantmateriet (${response.status}): ${details}`);
  }

  const tokenData = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + Math.max(0, tokenData.expires_in - 60) * 1000,
  };

  return {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
  };
}

function buildHealthEndpoint(baseUrl: string): { endpoint: string; collection: string; lookupMode: "ogc" | "custom" } {
  const lookupMode = (process.env.LANTMATERIET_LOOKUP_MODE || "").trim().toLowerCase();
  const collection = process.env.LANTMATERIET_OGC_COLLECTION || "registerenhetsomradesytor";
  const usesOgc = lookupMode === "ogc" || baseUrl.toLowerCase().includes("/ogc-features/");

  if (usesOgc) {
    return {
      endpoint: `${baseUrl}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?limit=1`,
      collection,
      lookupMode: "ogc",
    };
  }

  const customEndpoint =
    process.env.LANTMATERIET_HEALTHCHECK_URL ||
    process.env.LANTMATERIET_LOOKUP_ENDPOINT ||
    `${baseUrl}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?limit=1`;

  return {
    endpoint: customEndpoint,
    collection,
    lookupMode: "custom",
  };
}

export async function loader(_args: LoaderFunctionArgs) {
  const baseUrl = resolveBaseUrl();
  const scope = resolveScope(baseUrl);
  const { endpoint, collection, lookupMode } = buildHealthEndpoint(baseUrl);

  try {
    const { accessToken, expiresIn } = await getAccessToken(baseUrl);
    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/geo+json, application/json",
        "X-Client-System": "Miljobeslut.se 2.0",
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      return json(
        {
          ok: false,
          message: "OGC fastighetsatkomst misslyckades.",
          error: "OGC fastighetsatkomst misslyckades.",
          status: response.status,
          details: responseText.slice(0, 500),
          endpoint,
          scope,
          lookupMode,
          collection,
        },
        { status: response.status },
      );
    }

    let featureCount: number | null = null;
    try {
      const payload = JSON.parse(responseText) as { features?: unknown[] };
      featureCount = Array.isArray(payload.features) ? payload.features.length : null;
    } catch {
      featureCount = null;
    }

    return json({
      ok: true,
      message: "OGC fastighetsatkomst verifierad.",
      status: response.status,
      expires_in: expiresIn,
      endpoint,
      scope,
      lookupMode,
      collection,
      featureCount,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: "Ett ovantat fel uppstod vid kommunikation med Lantmateriet.",
        error: "Ett ovantat fel uppstod vid kommunikation med Lantmateriet.",
        status: 500,
        details: String(error),
        endpoint,
        scope,
        lookupMode,
        collection,
      },
      { status: 500 },
    );
  }
}
