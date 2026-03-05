import { appendPropertyAudit } from "../security/auditTrail";
import { writePropertyAccessLog } from "../repositories/auditRepository";
import { assertProjectMembership } from "../repositories/projectAccessRepository";
import { getEnv, isLantmaterietOpenMode } from "../security/env";
import { assertPermission, validatePropertyLookupInput } from "../security/projectAccess";
import type { AuthUser, PropertyLookupInput } from "../security/types";

interface LantmaterietLookupResponse {
  geometry: unknown;
  boundaries: unknown;
  ownership?: unknown;
  designation?: string;
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

let cachedLantmaterietToken: { token: string; expiresAt: number } | null = null;

async function getLantmaterietAccessToken(): Promise<string> {
  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
  const baseUrl = getEnv("LANTMATERIET_BASE_URL"); // Should be https://api-ver.lantmateriet.se

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
  const tokenUrl = `${baseUrl.replace(/\/+$/, "")}/token`;
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ grant_type: "client_credentials" })
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Lantmateriet Access Token (${response.status})`);
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

  const baseUrl = getEnv("LANTMATERIET_BASE_URL");
  const accessToken = await getLantmaterietAccessToken();

  // Note: Depending on the specific API subscribed to, the endpoint might differ. 
  // We assume the standard fastighetsindelning/geodatakatalog API format for this request.
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/distribution/produkter/fastighet/v2.1/fastighet`;
  const url = `${endpoint}?beteckning=${encodeURIComponent(input.propertyDesignation)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-Client-System": "Miljobeslut.se 2.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Lantmateriet lookup failed (${response.status})`);
  }

  const raw = (await response.json()) as LantmaterietLookupResponse;
  const minimized = minimizePropertyPayload(raw);

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
