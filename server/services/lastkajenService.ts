/**
 * Lastkajen 2 API (Trafikverket) – REST/JSON för publicerade datapaket och filnedladdning.
 * @see Lastkajen2_API_Information.pdf (v1.4)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://lastkajen.trafikverket.se';
const TOKEN_EXPIRY_BUFFER_MS = 120_000;
const DOWNLOAD_TOKEN_MAX_AGE_MS = 55_000;

const REQUEST_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Miljöbeslut/2.0 (+https://miljobeslut.se)',
};

export interface LastkajenConfig {
  baseUrl: string;
  userName: string;
  password: string;
  configured: boolean;
}

export interface LastkajenLoginResponse {
  access_token: string;
  expires_in: number;
  is_external?: boolean;
}

export interface LastkajenFolderRef {
  id: number;
  name: string;
  path: string;
}

export interface LastkajenDataPackage {
  id: number;
  name: string;
  description?: string;
  published?: boolean;
  sourceFolder?: string;
  targetFolder?: LastkajenFolderRef;
}

export interface LastkajenPackageFileLink {
  href: string;
  rel: string;
  method: string;
  isTemplated?: boolean;
}

export interface LastkajenPackageFile {
  isFolder: boolean;
  name: string;
  size?: string;
  dateTime?: string;
  links?: LastkajenPackageFileLink[];
}

export interface LastkajenStatus {
  configured: boolean;
  baseUrl: string;
  isExternal?: boolean;
  tokenExpiresAt?: string;
  packageCount?: number;
  warning?: string;
}

type CachedAccessToken = {
  token: string;
  expiresAt: number;
  isExternal?: boolean;
};

let cachedAccess: CachedAccessToken | null = null;

export function getLastkajenConfig(): LastkajenConfig {
  const baseUrl = String(process.env.LASTKAJEN_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const userName = String(process.env.LASTKAJEN_USERNAME || '').trim();
  const password = String(process.env.LASTKAJEN_PASSWORD || '').trim();
  return {
    baseUrl,
    userName,
    password,
    configured: userName.length > 0 && password.length > 0,
  };
}

/** Endast för tester. */
export function resetLastkajenTokenCache(): void {
  cachedAccess = null;
}

function apiUrl(baseUrl: string, apiPath: string, params?: Record<string, string | number>): string {
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function parseDownloadTokenPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Tomt download-token från Lastkajen');
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'string') return parsed;
  } catch {
    // Plain string token
  }
  return trimmed.replace(/^"|"$/g, '');
}

async function loginLastkajen(): Promise<LastkajenLoginResponse> {
  const config = getLastkajenConfig();
  if (!config.configured) {
    throw new Error('LASTKAJEN_USERNAME och LASTKAJEN_PASSWORD måste vara satta');
  }

  const response = await fetch(apiUrl(config.baseUrl, '/api/Identity/Login'), {
    method: 'POST',
    headers: REQUEST_HEADERS,
    body: JSON.stringify({
      UserName: config.userName,
      Password: config.password,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Lastkajen login misslyckades (HTTP ${response.status})`);
  }

  let payload: LastkajenLoginResponse;
  try {
    payload = JSON.parse(text) as LastkajenLoginResponse;
  } catch {
    throw new Error('Lastkajen login returnerade ogiltigt JSON');
  }

  if (!payload.access_token) {
    throw new Error('Lastkajen login saknar access_token');
  }
  return payload;
}

async function getAccessToken(): Promise<CachedAccessToken> {
  if (cachedAccess && Date.now() < cachedAccess.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
    return cachedAccess;
  }
  const login = await loginLastkajen();
  cachedAccess = {
    token: login.access_token,
    expiresAt: Date.now() + Math.max(login.expires_in, 60) * 1000,
    isExternal: login.is_external,
  };
  return cachedAccess;
}

async function authorizedJsonGet<T>(apiPath: string, params?: Record<string, string | number>): Promise<T> {
  const config = getLastkajenConfig();
  const access = await getAccessToken();
  const response = await fetch(apiUrl(config.baseUrl, apiPath, params), {
    method: 'GET',
    headers: {
      ...REQUEST_HEADERS,
      Authorization: `Bearer ${access.token}`,
    },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Lastkajen ${apiPath} misslyckades (HTTP ${response.status})`);
  }
  return JSON.parse(text) as T;
}

export async function listPublishedDataPackages(): Promise<LastkajenDataPackage[]> {
  const rows = await authorizedJsonGet<LastkajenDataPackage[]>(
    '/api/DataPackage/GetPublishedDataPackages',
  );
  return Array.isArray(rows) ? rows : [];
}

export async function listDataPackageFiles(packageId: number): Promise<LastkajenPackageFile[]> {
  const rows = await authorizedJsonGet<LastkajenPackageFile[]>(
    '/api/DataPackage/GetDataPackageFiles',
    { id: packageId },
  );
  return Array.isArray(rows) ? rows : [];
}

export async function getDataPackageDownloadToken(
  packageId: number,
  fileName: string,
): Promise<string> {
  const config = getLastkajenConfig();
  const access = await getAccessToken();
  const response = await fetch(
    apiUrl(config.baseUrl, '/api/file/GetDataPackageDownloadToken', {
      id: packageId,
      fileName,
    }),
    {
      method: 'GET',
      headers: {
        ...REQUEST_HEADERS,
        Authorization: `Bearer ${access.token}`,
      },
      signal: AbortSignal.timeout(30000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Lastkajen download-token misslyckades (HTTP ${response.status})`);
  }
  return parseDownloadTokenPayload(text);
}

export async function downloadDataPackageFile(token: string): Promise<Response> {
  const config = getLastkajenConfig();
  const response = await fetch(
    apiUrl(config.baseUrl, '/api/File/GetDataPackageFile', { token }),
    {
      method: 'GET',
      headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] },
      signal: AbortSignal.timeout(300000),
    },
  );
  if (!response.ok) {
    throw new Error(`Lastkajen filnedladdning misslyckades (HTTP ${response.status})`);
  }
  return response;
}

export async function downloadDataPackageFileToPath(
  packageId: number,
  fileName: string,
  destinationPath: string,
): Promise<{ destinationPath: string; bytesWritten: number }> {
  const downloadToken = await getDataPackageDownloadToken(packageId, fileName);
  const started = Date.now();
  const response = await downloadDataPackageFile(downloadToken);
  if (Date.now() - started > DOWNLOAD_TOKEN_MAX_AGE_MS) {
    throw new Error('Nedladdning överskred 55s – engångstoken kan ha gått ut, försök igen');
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destinationPath, buffer);
  return { destinationPath, bytesWritten: buffer.length };
}

export async function getLastkajenStatus(): Promise<LastkajenStatus> {
  const config = getLastkajenConfig();
  if (!config.configured) {
    return {
      configured: false,
      baseUrl: config.baseUrl,
      warning: 'LASTKAJEN_USERNAME / LASTKAJEN_PASSWORD saknas',
    };
  }

  try {
    const access = await getAccessToken();
    const packages = await listPublishedDataPackages();
    return {
      configured: true,
      baseUrl: config.baseUrl,
      isExternal: access.isExternal,
      tokenExpiresAt: new Date(access.expiresAt).toISOString(),
      packageCount: packages.length,
    };
  } catch (error: unknown) {
    return {
      configured: true,
      baseUrl: config.baseUrl,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function pingLastkajen(): Promise<{
  ok: boolean;
  source: 'lastkajen';
  endpoint: string;
  details?: string;
  packageCount?: number;
}> {
  const config = getLastkajenConfig();
  const endpoint = config.baseUrl;
  if (!config.configured) {
    return {
      ok: false,
      source: 'lastkajen',
      endpoint,
      details: 'LASTKAJEN_USERNAME / LASTKAJEN_PASSWORD saknas',
    };
  }

  try {
    const packages = await listPublishedDataPackages();
    return {
      ok: true,
      source: 'lastkajen',
      endpoint,
      packageCount: packages.length,
    };
  } catch (error: unknown) {
    return {
      ok: false,
      source: 'lastkajen',
      endpoint,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}
