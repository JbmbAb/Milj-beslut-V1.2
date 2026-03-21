import { appendPropertyAudit } from "../security/auditTrail";
import { writePropertyAccessLog } from "../repositories/auditRepository";
import { assertProjectMembership } from "../repositories/projectAccessRepository";
import { isLantmaterietOpenMode, hasLantmaterietAuth } from "../security/env";
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

  // --- DEMO FALLBACK (when LANTMATERIET_DEMO_MODE=true or no real credentials configured) ---
  const upperDesignation = input.propertyDesignation.toUpperCase();
  const demoMode = process.env.LANTMATERIET_DEMO_MODE === 'true' || !hasLantmaterietAuth();

  if (demoMode) {
    logger.info('Lantmateriet: using demo data', { propertyDesignation: input.propertyDesignation, demoMode: true });

    // Well-known test designations get specific coordinates; others get a deterministic offset in Stockholm.
    let coords: number[][][];
    if (upperDesignation.includes("NACKA")) {
      coords = [[[18.25, 59.33], [18.26, 59.33], [18.26, 59.32], [18.25, 59.32], [18.25, 59.33]]];
    } else if (upperDesignation.includes("ORSA") || upperDesignation.includes("STACKMORA")) {
      coords = [[[14.73, 61.12], [14.74, 61.12], [14.74, 61.11], [14.73, 61.11], [14.73, 61.12]]];
    } else {
      // Deterministic offset from Stockholm city center based on designation string hash.
      // Uses multiplier 31 (Java String.hashCode() algorithm) for stable cross-platform results.
      const hash = Array.from(upperDesignation).reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0x7fffffff, 0);
      const lon = 18.07 + ((hash % 100) / 1000);
      const lat = 59.33 + ((Math.floor(hash / 100) % 100) / 1000);
      coords = [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat - 0.01], [lon, lat - 0.01], [lon, lat]]];
    }

    const mockFeature = {
      geometry: { type: "Polygon", coordinates: coords },
      properties: { etikett: upperDesignation },
    };

    const minimized = {
      ...minimizeOgcFeaturePayload({ features: [mockFeature] }, input.propertyDesignation),
      _demo: true,
    };

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

export interface LantmaterietConnectionTestResult {
  ok: boolean;
  mode: "demo" | "real";
  authMethod: string | null;
  tokenFetched: boolean;
  sampleLookupOk: boolean | null;
  sampleDesignation: string;
  sampleGeometry: unknown;
  error: string | null;
  setupGuide: string[];
}

/**
 * Tests the Lantmäteriet connection end-to-end.
 * 1. Checks if real credentials are configured.
 * 2. Attempts to fetch an access token.
 * 3. Attempts a lightweight OGC lookup for a known test designation.
 * Returns a detailed report without requiring project membership (admin only).
 */
export async function testLantmaterietConnection(): Promise<LantmaterietConnectionTestResult> {
  const demoMode = process.env.LANTMATERIET_DEMO_MODE === 'true' || !hasLantmaterietAuth();

  let authMethod: string | null = null;
  if (String(process.env.LANTMATERIET_CONSUMER_KEY || '').trim()) {
    authMethod = 'OAuth2 (LANTMATERIET_CONSUMER_KEY + LANTMATERIET_CONSUMER_SECRET)';
  } else if (String(process.env.LANTMATERIET_ACCESS_TOKEN || '').trim()) {
    authMethod = 'Direkttoken (LANTMATERIET_ACCESS_TOKEN)';
  } else if (String(process.env.LANTMATERIET_API_KEY || '').trim()) {
    authMethod = 'Legacy API-nyckel (LANTMATERIET_API_KEY)';
  }

  if (demoMode) {
    return {
      ok: false,
      mode: 'demo',
      authMethod: null,
      tokenFetched: false,
      sampleLookupOk: null,
      sampleDesignation: '',
      sampleGeometry: null,
      error: 'Lantmäteriet-credentials saknas — demo-läge aktivt',
      setupGuide: [
        'Gå till https://www.lantmateriet.se/en/about-lantmateriet/it-services/api-portal/',
        'Registrera ett konto och skapa en applikation',
        'Välj produkten "Fastighet och samfällighet Direkt" eller OGC Features (registerenhetsomradesytor)',
        'Kopiera Consumer Key + Consumer Secret',
        'Sätt LANTMATERIET_CONSUMER_KEY och LANTMATERIET_CONSUMER_SECRET i .env',
        'Sätt LANTMATERIET_LOOKUP_MODE=ogc och LANTMATERIET_BASE_URL=https://api.lantmateriet.se/ogc-features/v1',
        'Starta om servern — demo-läge inaktiveras automatiskt',
      ],
    };
  }

  // Try token
  let accessToken: string;
  try {
    accessToken = await getLantmaterietAccessToken();
  } catch (err) {
    return {
      ok: false,
      mode: 'real',
      authMethod,
      tokenFetched: false,
      sampleLookupOk: null,
      sampleDesignation: '',
      sampleGeometry: null,
      error: `Token-hämtning misslyckades: ${err instanceof Error ? err.message : String(err)}`,
      setupGuide: [
        'Kontrollera att LANTMATERIET_CONSUMER_KEY och LANTMATERIET_CONSUMER_SECRET är korrekta',
        `Token URL: ${process.env.LANTMATERIET_TOKEN_URL ?? 'https://apimanager.lantmateriet.se/oauth2/token'}`,
        'Kontrollera att applikationen i API-portalen är aktiverad och prenumerationen är aktiv',
      ],
    };
  }

  // Try OGC lookup for a known designation
  const baseUrl = (process.env.LANTMATERIET_BASE_URL || 'https://api.lantmateriet.se/ogc-features/v1').replace(/\/+$/, '');
  const collection = process.env.LANTMATERIET_OGC_COLLECTION || 'registerenhetsomradesytor';
  const testDesignation = 'NACKA BOO 1:1';
  const filter = `kommunnamn = 'NACKA' AND trakt = 'BOO' AND etikett = '1:1'`;
  const lookupUrl = `${baseUrl}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?filter=${encodeURIComponent(filter)}&filter-lang=cql2-text&limit=1`;

  try {
    const resp = await fetch(lookupUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/geo+json, application/json',
        'X-Client-System': 'Miljobeslut.se 2.0',
      },
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      const scopeMsg = buildScopeMessage(resp.status, errBody);
      const productMsg = buildMissingProductMessage(baseUrl, resp.status);
      return {
        ok: false,
        mode: 'real',
        authMethod,
        tokenFetched: true,
        sampleLookupOk: false,
        sampleDesignation: testDesignation,
        sampleGeometry: null,
        error: scopeMsg ?? productMsg ?? `OGC lookup HTTP ${resp.status}: ${errBody.slice(0, 300)}`,
        setupGuide: [
          'Kontrollera att din prenumeration inkluderar OGC Features (fastighetsindelning)',
          'Kontrollera att LANTMATERIET_SCOPE innehåller ogc-features:fastighetsindelning.read om scope krävs',
          `Testade endpoint: ${lookupUrl}`,
        ],
      };
    }

    const data = (await resp.json()) as OgcFeatureCollection;
    const feature = data.features?.[0];
    return {
      ok: true,
      mode: 'real',
      authMethod,
      tokenFetched: true,
      sampleLookupOk: Boolean(feature),
      sampleDesignation: testDesignation,
      sampleGeometry: feature?.geometry ?? null,
      error: feature ? null : `Fastighet "${testDesignation}" hittades inte — API fungerar men beteckningen saknas (normalt för test)`,
      setupGuide: [],
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'real',
      authMethod,
      tokenFetched: true,
      sampleLookupOk: false,
      sampleDesignation: testDesignation,
      sampleGeometry: null,
      error: `OGC-uppslag misslyckades: ${err instanceof Error ? err.message : String(err)}`,
      setupGuide: [`Testade endpoint: ${lookupUrl}`],
    };
  }
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
