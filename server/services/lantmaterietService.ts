import { appendPropertyAudit } from "../security/auditTrail";
import { writePropertyAccessLog } from "../repositories/auditRepository";
import { assertProjectMembership } from "../repositories/projectAccessRepository";
import { isLantmaterietOpenMode } from "../security/env";
import { assertPermission, validatePropertyLookupInput } from "../security/projectAccess";
import { logger } from "../logger";
import type { AuthUser, PropertyLookupInput } from "../security/types";

interface LantmaterietLookupResponse {
  geometry: unknown;
  boundaries: unknown;
  ownership?: unknown;
  designation?: string;
}

interface OgcFeature {
  geometry?: unknown;
  properties?: Record<string, unknown>;
}

interface OgcFeatureCollection {
  features?: OgcFeature[];
}

interface ParsedOgcDesignation {
  municipality: string | null;
  tract: string | null;
  label: string;
  exactFilter: string;
  tractFilter: string | null;
}

function buildMissingProductMessage(baseUrl: string, status: number): string | null {
  if (status !== 404) {
    return null;
  }

  if (baseUrl.toLowerCase().includes("/fapi")) {
    return [
      "Nuvarande Lantmateriet-API (FAPI) ar inte ett fastighetsuppslags-API.",
      "FAPI i er tenant stodjer inskrivningsatgarder (anteckning/avtalsrattighet/inteckning/komplettering), inte GET-uppslag pa fastighetsbeteckning.",
      "Saknad produkt: direktatkomst for fastighetsuppslag (t.ex. Registerbeteckning Direkt / Fastighet och samfallighet Direkt / Rattighet Direkt enligt avtal).",
      "Atgard: aktivera ratt produkt i devportalen och uppdatera endpoint for property lookup."
    ].join(" ");
  }

  return "Uppslagsendpoint hittades inte for nuvarande Lantmateriet-produkt. Kontrollera subscription och endpoint i API-portalen.";
}

function buildScopeMessage(status: number, responseText: string): string | null {
  if (status !== 403) {
    return null;
  }

  const normalized = responseText.toLowerCase();
  if (!normalized.includes("scope") && !normalized.includes("900910") && !normalized.includes("not authorized")) {
    return null;
  }

  return [
    "Access token saknar ratt scope for fastighetsuppslag.",
    "For OGC Features kravs normalt scope: ogc-features:fastighetsindelning.read.",
    "Skapa ny token i devportalen med korrekt scope och prova igen."
  ].join(" ");
}

function redactOwnership(ownership: unknown): unknown {
  if (!ownership || typeof ownership !== "object") {
    return undefined;
  }
  const value = ownership as Record<string, unknown>;
  return {
    ownerType: value.ownerType ?? null,
    share: value.share ?? null,
  };
}

function minimizePropertyPayload(raw: LantmaterietLookupResponse): Record<string, unknown> {
  return {
    designation: raw.designation ?? null,
    geometry: raw.geometry ?? null,
    boundaries: raw.boundaries ?? null,
    ownership: redactOwnership(raw.ownership),
  };
}

function escapeCqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function normalizeDesignationLabel(value: string | null | undefined): string {
  return String(value || "").trim().toUpperCase();
}

function designationBase(value: string | null | undefined): string {
  return normalizeDesignationLabel(value).split(">")[0] || "";
}

function extractOgcFeatureLabel(feature: OgcFeature): string {
  return String(feature.properties?.etikett ?? "").trim();
}

export function parseOgcDesignation(propertyDesignation: string): ParsedOgcDesignation {
  const cleaned = propertyDesignation.trim();
  const rawParts = cleaned.split(/\s+/).filter(Boolean);

  if (rawParts.length >= 2) {
    const label = rawParts[rawParts.length - 1];
    const tract = rawParts[rawParts.length - 2];
    const municipality = rawParts.slice(0, rawParts.length - 2).join(" ") || null;
    const safeLabel = escapeCqlLiteral(label);
    const safeTract = escapeCqlLiteral(tract.toUpperCase());

    if (municipality) {
      const safeMunicipality = escapeCqlLiteral(municipality.toUpperCase());
      return {
        municipality: municipality.toUpperCase(),
        tract: tract.toUpperCase(),
        label,
        exactFilter: `kommunnamn = '${safeMunicipality}' AND trakt = '${safeTract}' AND etikett = '${safeLabel}'`,
        tractFilter: `kommunnamn = '${safeMunicipality}' AND trakt = '${safeTract}'`,
      };
    }

    return {
      municipality: null,
      tract: tract.toUpperCase(),
      label,
      exactFilter: `trakt = '${safeTract}' AND etikett = '${safeLabel}'`,
      tractFilter: `trakt = '${safeTract}'`,
    };
  }

  const safeDesignation = escapeCqlLiteral(cleaned);
  return {
    municipality: null,
    tract: null,
    label: cleaned,
    exactFilter: `etikett = '${safeDesignation}'`,
    tractFilter: null,
  };
}

function compareMatchedFeatureOrder(a: OgcFeature, b: OgcFeature, requestedLabel: string): number {
  const normalizedRequested = normalizeDesignationLabel(requestedLabel);
  const labelA = normalizeDesignationLabel(extractOgcFeatureLabel(a));
  const labelB = normalizeDesignationLabel(extractOgcFeatureLabel(b));

  const rank = (label: string): number => {
    if (label === normalizedRequested) return -1;
    if (!label.startsWith(`${normalizedRequested}>`)) return Number.MAX_SAFE_INTEGER;
    const suffix = label.slice(normalizedRequested.length + 1);
    const numericSuffix = Number.parseInt(suffix, 10);
    return Number.isFinite(numericSuffix) ? numericSuffix : Number.MAX_SAFE_INTEGER - 1;
  };

  const rankA = rank(labelA);
  const rankB = rank(labelB);
  if (rankA !== rankB) return rankA - rankB;
  return labelA.localeCompare(labelB, "sv-SE");
}

export function findMatchingOgcFeatures(features: OgcFeature[], requestedDesignation: string): OgcFeature[] {
  const parsed = parseOgcDesignation(requestedDesignation);
  const requestedLabel = normalizeDesignationLabel(parsed.label);
  const exactSplitRequested = requestedLabel.includes(">");

  return features
    .filter((feature) => {
      const label = normalizeDesignationLabel(extractOgcFeatureLabel(feature));
      if (!label) return false;
      if (label === requestedLabel) return true;
      if (exactSplitRequested) return false;
      return designationBase(label) === requestedLabel;
    })
    .sort((a, b) => compareMatchedFeatureOrder(a, b, parsed.label));
}

export function mergeOgcFeatureGeometry(features: OgcFeature[]): unknown {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0].geometry ?? null;

  const polygons: unknown[] = [];
  for (const feature of features) {
    const geometry = feature.geometry as { type?: string; coordinates?: unknown } | undefined;
    if (!geometry?.type) continue;
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
      polygons.push(geometry.coordinates);
      continue;
    }
    if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      polygons.push(...geometry.coordinates);
      continue;
    }
    return features[0].geometry ?? null;
  }

  if (polygons.length === 0) {
    return features[0].geometry ?? null;
  }

  return {
    type: "MultiPolygon",
    coordinates: polygons,
  };
}

export function minimizeOgcFeaturePayload(features: OgcFeature[] | OgcFeatureCollection, requestedDesignation: string): Record<string, unknown> {
  const normalizedFeatures = Array.isArray(features) ? features : (features.features ?? []);
  const firstFeature = normalizedFeatures[0];
  const matchedLabels = normalizedFeatures
    .map((feature) => extractOgcFeatureLabel(feature))
    .filter(Boolean);
  const designation =
    matchedLabels.length === 1
      ? matchedLabels[0]
      : requestedDesignation;

  return {
    designation,
    geometry: mergeOgcFeatureGeometry(normalizedFeatures),
    boundaries:
      normalizedFeatures.length <= 1
        ? firstFeature ?? null
        : {
            type: "FeatureCollection",
            features: normalizedFeatures,
          },
    ownership: undefined,
    matchedDesignations: matchedLabels.length > 0 ? matchedLabels : undefined,
  };
}

let cachedLantmaterietToken: { token: string; expiresAt: number } | null = null;

async function getLantmaterietAccessToken(): Promise<string> {
  const directAccessToken = process.env.LANTMATERIET_ACCESS_TOKEN?.trim();
  if (directAccessToken) {
    return directAccessToken;
  }

  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
  const baseUrl = (process.env.LANTMATERIET_BASE_URL || "https://api.lantmateriet.se/ogc-features/v1").trim();

  if (!consumerKey || !consumerSecret) {
    if (isLantmaterietOpenMode()) {
      throw new Error("Lantmateriet property lookup requires valid consumer keys. Open mode supports map/WMS testing only.");
    }
    throw new Error("Missing env variables: LANTMATERIET_CONSUMER_KEY or LANTMATERIET_CONSUMER_SECRET");
  }

  // Check cache
  if (cachedLantmaterietToken && Date.now() < cachedLantmaterietToken.expiresAt) {
    return cachedLantmaterietToken.token;
  }

  // Fetch new token
  const configuredTokenUrl = process.env.LANTMATERIET_TOKEN_URL?.trim();
  const tokenUrl = configuredTokenUrl
    ? configuredTokenUrl
    : `${new URL(baseUrl).origin}/token`;
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const lookupMode = (process.env.LANTMATERIET_LOOKUP_MODE || "").trim().toLowerCase();
  const defaultScope = lookupMode === "ogc" ? "ogc-features:fastighetsindelning.read" : "";
  const scopeStr = process.env.LANTMATERIET_SCOPE || defaultScope;

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `grant_type=client_credentials${scopeStr ? `&scope=${encodeURIComponent(scopeStr)}` : ""}`
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to fetch Lantmateriet Access Token (${response.status}): ${err}`);
  }

  const data = await response.json() as { access_token: string, expires_in: number };

  // Cache the token, subtract 60 seconds as a buffer
  cachedLantmaterietToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000
  };

  return data.access_token;
}

function buildOgcItemsUrl(base: string, collection: string, filter: string, limit: number): string {
  return `${base}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?filter=${encodeURIComponent(filter)}&filter-lang=cql2-text&limit=${limit}`;
}

async function fetchLantmaterietLookupResponse(url: string, accessToken: string, allowRetry = true): Promise<Response> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/geo+json, application/json",
      "X-Client-System": "Miljobeslut.se 2.0",
    },
  });

  if (response.status === 401 && allowRetry) {
    cachedLantmaterietToken = null;
    const refreshedAccessToken = await getLantmaterietAccessToken();
    return fetchLantmaterietLookupResponse(url, refreshedAccessToken, false);
  }

  return response;
}

export async function lookupPropertyByDesignation(input: PropertyLookupInput, user: AuthUser): Promise<Record<string, unknown>> {
  validatePropertyLookupInput(input);
  assertPermission(user, "PROPERTY_LOOKUP");
  await assertProjectMembership({
    projectId: input.projectId,
    userId: user.id,
    organisationId: user.organisationId,
    role: user.role,
  });

  

  const baseUrl = (process.env.LANTMATERIET_BASE_URL || "https://api.lantmateriet.se/ogc-features/v1").trim();
  const accessToken = await getLantmaterietAccessToken();
  const base = baseUrl.replace(/\/+$/, "");
  const lookupMode = (process.env.LANTMATERIET_LOOKUP_MODE || "").trim().toLowerCase();
  const useOgcLookup = lookupMode === "ogc" || base.toLowerCase().includes("/ogc-features/");

  let url: string;
  if (useOgcLookup) {
    const collection = process.env.LANTMATERIET_OGC_COLLECTION || "registerenhetsomradesytor";
    const parsedDesignation = parseOgcDesignation(input.propertyDesignation);

    url = buildOgcItemsUrl(base, collection, parsedDesignation.exactFilter, 1);
  } else {
    const lookupEndpoint =
      process.env.LANTMATERIET_LOOKUP_ENDPOINT ||
      `${base}/distribution/produkter/fastighet/v2.1/fastighet`;
    url = `${lookupEndpoint}?beteckning=${encodeURIComponent(input.propertyDesignation)}`;
  }

  const response = await fetchLantmaterietLookupResponse(url, accessToken);

  if (!response.ok) {
    const errText = await response.text();
    logger.error('Lantmateriet API error response', { status: response.status, body: errText });
    const scopeMessage = buildScopeMessage(response.status, errText);
    if (scopeMessage) {
      throw new Error(`${scopeMessage} [HTTP ${response.status}]`);
    }
    const productMessage = buildMissingProductMessage(baseUrl, response.status);
    if (productMessage) {
      throw new Error(`${productMessage} [HTTP ${response.status}]`);
    }
    throw new Error(`Lantmateriet lookup failed (${response.status}): ${errText}`);
  }

  let minimized: Record<string, unknown>;
  if (useOgcLookup) {
    let ogc = (await response.json()) as OgcFeatureCollection;
    const parsedDesignation = parseOgcDesignation(input.propertyDesignation);

    if ((!ogc.features || ogc.features.length === 0) && parsedDesignation.tractFilter) {
      const collection = process.env.LANTMATERIET_OGC_COLLECTION || "registerenhetsomradesytor";
      const fallbackUrl = buildOgcItemsUrl(base, collection, parsedDesignation.tractFilter, 2000);
      const fallbackResponse = await fetchLantmaterietLookupResponse(fallbackUrl, accessToken);

      if (!fallbackResponse.ok) {
        const fallbackText = await fallbackResponse.text();
        logger.error('Lantmateriet API fallback response', { status: fallbackResponse.status, body: fallbackText });
        throw new Error(`Lantmateriet fallback lookup failed (${fallbackResponse.status}): ${fallbackText}`);
      }

      const fallbackCollection = (await fallbackResponse.json()) as OgcFeatureCollection;
      const matchedFeatures = findMatchingOgcFeatures(fallbackCollection.features ?? [], input.propertyDesignation);
      if (matchedFeatures.length > 0) {
        ogc = { features: matchedFeatures };
      }
    }

    if (!ogc.features || ogc.features.length === 0) {
      throw new Error(`Fastighet hittades inte: ${input.propertyDesignation}`);
    }
    minimized = minimizeOgcFeaturePayload(ogc, input.propertyDesignation);
  } else {
    const raw = (await response.json()) as LantmaterietLookupResponse;
    minimized = minimizePropertyPayload(raw);
  }

  const auditEvent = {
    userId: user.id,
    projectId: input.projectId,
    propertyDesignation: input.propertyDesignation,
    purpose: input.purpose,
    responseClass: "ownership_redacted",
  } as const;

  await appendPropertyAudit(auditEvent);
  await writePropertyAccessLog(auditEvent);

  return minimized;
}

export async function getLantmaterietOpenMapStatus(): Promise<{
  ok: boolean;
  status?: number;
  endpoint: string;
  mode: "open" | "licensed";
  sample?: string;
}> {
  const baseEndpoint =
    process.env.LANTMATERIET_OPEN_WMS_URL ||
    "https://apimanager.lantmateriet.se/open/topowebb-ccby/v1/wmts?request=GetCapabilities&version=1.0.0&service=wmts";
  const subscriptionKey = process.env.LANTMATERIET_OPEN_SUBSCRIPTION_KEY;
  const endpoint = subscriptionKey
    ? `${baseEndpoint}${baseEndpoint.includes("?") ? "&" : "?"}subscription-key=${encodeURIComponent(subscriptionKey)}`
    : baseEndpoint;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: { Accept: "*/*" },
  });
  const text = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    endpoint,
    mode: isLantmaterietOpenMode() ? "open" : "licensed",
    sample: text.slice(0, 220),
  };
}
