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

function minimizeOgcFeaturePayload(collection: OgcFeatureCollection, requestedDesignation: string): Record<string, unknown> {
  const feature = collection.features?.[0];
  const properties = feature?.properties ?? {};

  return {
    designation: String(properties.etikett ?? requestedDesignation),
    geometry: feature?.geometry ?? null,
    boundaries: feature ?? null,
    ownership: undefined,
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

export async function lookupPropertyByDesignation(input: PropertyLookupInput, user: AuthUser): Promise<Record<string, unknown>> {
  validatePropertyLookupInput(input);
  assertPermission(user, "PROPERTY_LOOKUP");
  await assertProjectMembership({
    projectId: input.projectId,
    userId: user.id,
    organisationId: user.organisationId,
    role: user.role,
  });

  // --- DEMO FALLBACK (only when LANTMATERIET_DEMO_MODE=true and no real credentials) ---
  const upperDesignation = input.propertyDesignation.toUpperCase();
  if (process.env.LANTMATERIET_DEMO_MODE === 'true' && (upperDesignation === "ORSA STACKMORA 3:12" || upperDesignation === "NACKA ORMINGE 7:8")) {
    logger.info('Lantmateriet: using mock data', { propertyDesignation: input.propertyDesignation });
    // Rough coordinates for demo map bounding boxes
    const coords = upperDesignation.includes("NACKA")
      ? [[[18.25, 59.33], [18.26, 59.33], [18.26, 59.32], [18.25, 59.32], [18.25, 59.33]]]
      : [[[14.73, 61.12], [14.74, 61.12], [14.74, 61.11], [14.73, 61.11], [14.73, 61.12]]];

    const mockFeature = {
      geometry: {
        type: "Polygon",
        coordinates: coords
      },
      properties: {
        etikett: upperDesignation
      }
    };

    const minimized = minimizeOgcFeaturePayload({ features: [mockFeature] }, input.propertyDesignation);

    const auditEvent = {
      userId: user.id,
      projectId: input.projectId,
      propertyDesignation: input.propertyDesignation,
      purpose: input.purpose,
      responseClass: "geometry",
    } as const;

    await appendPropertyAudit(auditEvent);
    await writePropertyAccessLog(auditEvent);
    return minimized;
  }
  // --- END DEMO FALLBACK ---

  const baseUrl = (process.env.LANTMATERIET_BASE_URL || "https://api.lantmateriet.se/ogc-features/v1").trim();
  const accessToken = await getLantmaterietAccessToken();
  const base = baseUrl.replace(/\/+$/, "");
  const lookupMode = (process.env.LANTMATERIET_LOOKUP_MODE || "").trim().toLowerCase();
  const useOgcLookup = lookupMode === "ogc" || base.toLowerCase().includes("/ogc-features/");

  let url: string;
  if (useOgcLookup) {
    const collection = process.env.LANTMATERIET_OGC_COLLECTION || "registerenhetsomradesytor";

    // Parse designation "COMMUNE TRACT LABEL"
    const rawParts = input.propertyDesignation.trim().split(/\s+/);
    let filter: string;

    if (rawParts.length >= 2) {
      const label = rawParts[rawParts.length - 1].replace(/'/g, "''");
      const tract = rawParts[rawParts.length - 2].replace(/'/g, "''");
      const muni = rawParts.slice(0, rawParts.length - 2).join(" ").replace(/'/g, "''");

      if (muni) {
        filter = `kommunnamn = '${muni.toUpperCase()}' AND trakt = '${tract.toUpperCase()}' AND etikett = '${label}'`;
      } else {
        filter = `trakt = '${tract.toUpperCase()}' AND etikett = '${label}'`;
      }
    } else {
      const safeDesignation = input.propertyDesignation.replace(/'/g, "''");
      filter = `etikett = '${safeDesignation}'`;
    }

    url = `${base}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?filter=${encodeURIComponent(filter)}&filter-lang=cql2-text&limit=1`;
  } else {
    const lookupEndpoint =
      process.env.LANTMATERIET_LOOKUP_ENDPOINT ||
      `${base}/distribution/produkter/fastighet/v2.1/fastighet`;
    url = `${lookupEndpoint}?beteckning=${encodeURIComponent(input.propertyDesignation)}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/geo+json, application/json",
      "X-Client-System": "Miljobeslut.se 2.0",
    },
  });

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
    const ogc = (await response.json()) as OgcFeatureCollection;
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
