import crypto from "node:crypto";
import { assertProjectMembership } from "../repositories/projectAccessRepository";
import { appendAuditTrailRow } from "../repositories/auditRepository";
import { getEnv } from "../security/env";
import { assertPermission } from "../security/projectAccess";
import type { AuthUser } from "../security/types";

export type SluProduct = "species_observations" | "taxonomy" | "artfakta" | "metodkatalog";
type SluMethod = "GET" | "POST";
type SluPingProbe = {
  method: SluMethod;
  pathSuffix?: string;
  query?: Record<string, string | number | boolean>;
  payload?: Record<string, unknown>;
};

const productEnvMap: Record<SluProduct, { keyEnv: string; pathEnv: string }> = {
  species_observations: {
    keyEnv: "SLU_SPECIES_OBS_API_KEY",
    pathEnv: "SLU_SPECIES_OBS_BASE_PATH",
  },
  taxonomy: {
    keyEnv: "SLU_TAXONOMY_API_KEY",
    pathEnv: "SLU_TAXONOMY_BASE_PATH",
  },
  artfakta: {
    keyEnv: "SLU_ARTFAKTA_API_KEY",
    pathEnv: "SLU_ARTFAKTA_BASE_PATH",
  },
  metodkatalog: {
    keyEnv: "SLU_METODKATALOG_API_KEY",
    pathEnv: "SLU_METODKATALOG_BASE_PATH",
  },
};

const productPingProbeMap: Record<SluProduct, SluPingProbe> = {
  species_observations: {
    method: "POST",
    payload: {},
  },
  taxonomy: {
    method: "POST",
    pathSuffix: "/taxa",
    payload: {},
  },
  artfakta: {
    method: "GET",
    pathSuffix: "/speciesdata",
    query: { taxa: "100024" },
  },
  metodkatalog: {
    method: "GET",
    pathSuffix: "/About/version",
  },
};

function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function normalizePath(path: string): string {
  if (!path) {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function assertSafeSuffix(pathSuffix: string): string {
  if (!pathSuffix) {
    return "";
  }
  if (pathSuffix.includes("://") || pathSuffix.startsWith("//")) {
    throw new Error("Invalid SLU pathSuffix");
  }
  return normalizePath(pathSuffix);
}

function resolveProductConfig(product: SluProduct): { apiKey: string; basePath: string } {
  const mapping = productEnvMap[product];
  if (!mapping) {
    throw new Error(`Unsupported SLU product: ${product}`);
  }

  const apiKey = process.env[mapping.keyEnv] || process.env.SLU_API_KEY;
  if (!apiKey) {
    throw new Error(`Missing env variable: ${mapping.keyEnv} (or fallback SLU_API_KEY)`);
  }

  const basePath = process.env[mapping.pathEnv];
  if (!basePath) {
    throw new Error(`Missing env variable: ${mapping.pathEnv}`);
  }

  return {
    apiKey,
    basePath: normalizePath(basePath),
  };
}

function encodeQuery(query: Record<string, string | number | boolean> | undefined): string {
  if (!query || Object.keys(query).length === 0) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  return `?${params.toString()}`;
}

async function writeSluAudit(input: {
  userId: string;
  projectId?: string;
  purpose: string;
  product: SluProduct;
  payload: unknown;
}): Promise<void> {
  await appendAuditTrailRow({
    entityType: "SLUApiCall",
    entityId: input.projectId || `global:${input.product}`,
    action: "READ",
    userId: input.userId,
    timestamp: new Date(),
    payloadHash: crypto.createHash("sha256").update(JSON.stringify(input.payload ?? {})).digest("hex"),
    prevHash: null,
    chainHash: crypto.randomUUID(),
  });
}

export async function callSluProductApi(input: {
  product: SluProduct;
  method: SluMethod;
  pathSuffix?: string;
  query?: Record<string, string | number | boolean>;
  payload?: Record<string, unknown>;
  projectId?: string;
  purpose: string;
  user: AuthUser;
}): Promise<unknown> {
  if (!input.purpose) {
    throw new Error("purpose is required");
  }

  assertPermission(input.user, "PROPERTY_LOOKUP");
  if (input.projectId) {
    await assertProjectMembership({
      projectId: input.projectId,
      userId: input.user.id,
      organisationId: input.user.organisationId,
      role: input.user.role,
    });
  }

  const baseUrl = normalizeBaseUrl(getEnv("SLU_API_BASE_URL"));
  const { apiKey, basePath } = resolveProductConfig(input.product);
  const suffix = assertSafeSuffix(input.pathSuffix || "");
  const queryString = encodeQuery(input.query);
  const url = `${baseUrl}${basePath}${suffix}${queryString}`;

  const response = await fetch(url, {
    method: input.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": apiKey,
    },
    body: input.method === "POST" ? JSON.stringify(input.payload ?? {}) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`SLU ${input.product} error (${response.status}): ${text.slice(0, 300)}`);
  }

  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Keep raw text.
  }

  await writeSluAudit({
    userId: input.user.id,
    projectId: input.projectId,
    purpose: input.purpose,
    product: input.product,
    payload: {
      method: input.method,
      pathSuffix: input.pathSuffix,
      query: input.query,
      payload: input.payload,
    },
  });

  return parsed;
}

export function getSluProductStatus(): Array<{
  product: SluProduct;
  hasApiKey: boolean;
  hasBasePath: boolean;
}> {
  return (Object.keys(productEnvMap) as SluProduct[]).map((product) => {
    const envNames = productEnvMap[product];
    return {
      product,
      hasApiKey: Boolean(process.env[envNames.keyEnv] || process.env.SLU_API_KEY),
      hasBasePath: Boolean(process.env[envNames.pathEnv]),
    };
  });
}

export async function pingSluProduct(product: SluProduct): Promise<{ ok: boolean; status: number; endpoint: string }> {
  const base = normalizeBaseUrl(getEnv("SLU_API_BASE_URL"));
  const config = resolveProductConfig(product);
  const probe = productPingProbeMap[product] || { method: "GET" };
  const suffix = assertSafeSuffix(probe.pathSuffix || "");
  const queryString = encodeQuery(probe.query);
  const endpoint = `${base}${config.basePath}${suffix}${queryString}`;
  const response = await fetch(endpoint, {
    method: probe.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Ocp-Apim-Subscription-Key": config.apiKey,
    },
    body: probe.method === "POST" ? JSON.stringify(probe.payload ?? {}) : undefined,
  });
  return {
    ok: response.ok,
    status: response.status,
    endpoint,
  };
}

export async function searchSluObservations(input: {
  projectId: string;
  purpose: string;
  payload: Record<string, unknown>;
  user: AuthUser;
}): Promise<unknown> {
  if (!input.projectId) {
    throw new Error("projectId is required for species observations");
  }
  return callSluProductApi({
    product: "species_observations",
    method: "POST",
    pathSuffix: "",
    payload: input.payload,
    projectId: input.projectId,
    purpose: input.purpose,
    user: input.user,
  });
}
