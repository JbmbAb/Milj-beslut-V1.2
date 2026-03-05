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
  const apiKey = process.env.LANTMATERIET_API_KEY;
  if (!apiKey) {
    if (isLantmaterietOpenMode()) {
      throw new Error("Lantmateriet property lookup requires licensed API key. Open mode supports map/WMS testing only.");
    }
    throw new Error("Missing env variable: LANTMATERIET_API_KEY");
  }
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/fastighet`;
  const url = `${endpoint}?beteckning=${encodeURIComponent(input.propertyDesignation)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "X-Client-System": "RiskGuard.ai",
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
