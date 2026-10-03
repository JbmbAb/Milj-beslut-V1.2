import { csrfFetch } from './csrfClient';

const TOKEN_KEY = 'miljobeslut_admin_bearer';
const REFRESH_TOKEN_KEY = 'miljobeslut_admin_refresh';
const PROJECT_KEY = 'miljobeslut_admin_project';

type ApiCallOptions = {
  method?: string;
  body?: unknown;
  query?: Record<string, unknown>;
  auth?: boolean;
  headers?: Record<string, string>;
  retryOnUnauthorized?: boolean;
};

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

export function getToken(): string {
  if (!hasWindow()) return '';
  return String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
}

export function getRefreshToken(): string {
  if (!hasWindow()) return '';
  return String(window.localStorage.getItem(REFRESH_TOKEN_KEY) || '').trim();
}

export function getActiveProjectId(): string {
  if (!hasWindow()) return '';
  return String(window.localStorage.getItem(PROJECT_KEY) || '').trim();
}

export function setActiveProjectId(projectId: string | null | undefined): void {
  if (!hasWindow()) return;
  const normalized = String(projectId || '').trim();
  if (normalized) {
    window.localStorage.setItem(PROJECT_KEY, normalized);
    return;
  }
  window.localStorage.removeItem(PROJECT_KEY);
}

export function setSession(input: {
  accessToken: string;
  refreshToken?: string | null;
  activeProjectId?: string | null;
}): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(TOKEN_KEY, input.accessToken);

  const refreshToken = String(input.refreshToken || '').trim();
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } else {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  if (input.activeProjectId !== undefined) {
    setActiveProjectId(input.activeProjectId);
  }
}

export function clearSession(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(PROJECT_KEY);
}

/**
 * W-UI1-R2 (owner condition 2026-10-03; UI1-VERIFICATION finding 2): the ONE typed structure this client carries
 * beyond the codes -- the 424 ASSESSMENT_RECORD_INTEGRITY_ERROR's `record_integrity` -- rebuilt field by field from
 * an explicit whitelist, the same keys as the server's wire whitelist (recordIntegrityDiagnosticWire): known keys
 * and types only, the record id and the basis codes checked by form (a failing id is dropped, a failing code is
 * left out), arrays capped, counts non-negative safe integers, every unknown or nested unknown key dropped, the
 * server's note and every free text never carried. The source must say itself that it is unverified and not
 * authoritative; the result always says so. Any other answer, or any other code, carries none of it.
 * Own data properties only (never a getter, never the prototype chain).
 */
export const LU_RECORD_INTEGRITY_CODE = 'ASSESSMENT_RECORD_INTEGRITY_ERROR';
const RI_PLAIN_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RI_BASIS_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const RI_RULE_ID = /^LU-[A-Z]+(?:-[A-Z]+){0,3}-[0-9]{3}$/;
const RI_CHECKS: ReadonlySet<string> = new Set(['water', 'ebh', 'protected_area', 'natura2000', 'water_protection_area', 'document']);
const RI_LEVELS: ReadonlySet<string> = new Set(['HIGH', 'MEDIUM', 'LOW', 'NOT_CHECKED', 'UNKNOWN']);
const RI_HIGHEST: ReadonlySet<string> = new Set(['HIGH', 'MEDIUM', 'LOW']);
export const LU_RECORD_INTEGRITY_MAX_ENTRIES = 100;
export const LU_RECORD_INTEGRITY_MAX_BASIS_CODES = 32;

export interface LuRecordIntegrityWire {
  readonly authoritative: false;
  readonly verified: false;
  readonly assessment_artifact_id?: string;
  readonly basis_codes: readonly string[];
  readonly stored_findings_unverified?: {
    readonly total: number;
    readonly highest_level: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    readonly counts: {
      readonly high: number;
      readonly medium: number;
      readonly low: number;
      readonly not_checked: number;
      readonly unknown_level: number;
      readonly malformed: number;
    };
    readonly truncated: boolean;
    readonly entries: readonly {
      readonly check: string | null;
      readonly rule: string | null;
      readonly stored_level: string;
      readonly well_formed: boolean;
    }[];
  };
}

function riOwn(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/** The first `max` own elements of an array (a hole or an accessor is skipped); null when it is no array. */
function riList(value: unknown, max: number): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (typeof length !== 'number') return null;
  const out: unknown[] = [];
  for (let index = 0; index < Math.min(length, max); index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor && 'value' in descriptor) out.push(descriptor.value);
  }
  return out;
}

function riCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** The whitelisted record_integrity of one failed answer, or null (see LU_RECORD_INTEGRITY_CODE above). */
export function luRecordIntegrityWire(code: unknown, raw: unknown): LuRecordIntegrityWire | null {
  try {
    if (code !== LU_RECORD_INTEGRITY_CODE) return null;
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (riOwn(raw, 'authoritative') !== false || riOwn(raw, 'verified') !== false) return null;
    const id = riOwn(raw, 'assessment_artifact_id');
    const basis = [
      ...new Set(
        (riList(riOwn(raw, 'basis_codes'), LU_RECORD_INTEGRITY_MAX_BASIS_CODES) ?? []).filter(
          (value): value is string => typeof value === 'string' && RI_BASIS_CODE.test(value),
        ),
      ),
    ];
    const stored = riOwn(raw, 'stored_findings_unverified');
    const storedObject = stored !== null && typeof stored === 'object' && !Array.isArray(stored);
    const counts = riOwn(stored, 'counts');
    const entriesSource = riOwn(stored, 'entries');
    const entries = riList(entriesSource, LU_RECORD_INTEGRITY_MAX_ENTRIES) ?? [];
    const sourceLength = Array.isArray(entriesSource) ? Object.getOwnPropertyDescriptor(entriesSource, 'length')?.value : 0;
    const highest = riOwn(stored, 'highest_level');
    return {
      authoritative: false,
      verified: false,
      ...(typeof id === 'string' && RI_PLAIN_ARTIFACT_ID.test(id) ? { assessment_artifact_id: id } : {}),
      basis_codes: basis,
      ...(storedObject
        ? {
            stored_findings_unverified: {
              total: riCount(riOwn(stored, 'total')),
              highest_level: typeof highest === 'string' && RI_HIGHEST.has(highest) ? (highest as 'HIGH' | 'MEDIUM' | 'LOW') : null,
              counts: {
                high: riCount(riOwn(counts, 'high')),
                medium: riCount(riOwn(counts, 'medium')),
                low: riCount(riOwn(counts, 'low')),
                not_checked: riCount(riOwn(counts, 'not_checked')),
                unknown_level: riCount(riOwn(counts, 'unknown_level')),
                malformed: riCount(riOwn(counts, 'malformed')),
              },
              truncated: riOwn(stored, 'truncated') === true || (typeof sourceLength === 'number' && sourceLength > LU_RECORD_INTEGRITY_MAX_ENTRIES),
              entries: entries.map((entry) => {
                const check = riOwn(entry, 'check');
                const rule = riOwn(entry, 'rule');
                const level = riOwn(entry, 'stored_level');
                return {
                  check: typeof check === 'string' && RI_CHECKS.has(check) ? check : null,
                  rule: typeof rule === 'string' && RI_RULE_ID.test(rule) ? rule : null,
                  stored_level: typeof level === 'string' && RI_LEVELS.has(level) ? level : 'UNKNOWN',
                  well_formed: riOwn(entry, 'well_formed') === true,
                };
              }),
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function buildUrl(endpoint: string, query?: Record<string, unknown>): string {
  const baseOrigin =
    typeof window !== 'undefined' && typeof window.location?.origin === 'string'
      ? window.location.origin
      : 'http://localhost';
  const url = new URL(endpoint, baseOrigin);

  if (!query) return url.toString();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, String(value));
    }
  });

  return url.toString();
}

export async function callApi<T>(endpoint: string, options: ApiCallOptions = {}): Promise<T> {
  const {
    method = 'POST',
    body,
    query,
    auth = true,
    headers: extraHeaders,
    retryOnUnauthorized = true,
  } = options;
  const url = buildUrl(endpoint, query);

  const request = async () => {
    const token = getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    };

    if (auth && token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return csrfFetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  let response = await request();

  if (response.status === 401 && auth && retryOnUnauthorized && getRefreshToken()) {
    await refreshAccessSession();
    response = await request();
  }

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as {
      error?: string | { message?: string };
      message?: string;
      code?: unknown;
      failureClass?: unknown;
      reasonCode?: unknown;
      retryable?: unknown;
      record_integrity?: unknown;
    };
    const raw = err.error;
    const fromError =
      typeof raw === 'string' ? raw : raw && typeof raw === 'object' ? String(raw.message || '') : '';
    const msg = (fromError || err.message || '').trim() || `HTTP ${response.status}`;
    // DEMO M2b: the message stays exactly as before; the HTTP status and the machine-readable codes
    // the server sends (code / failureClass / reasonCode) are attached so the UI can show plain
    // Swedish text and keep the codes for "Teknisk information" instead of the raw server text.
    // W-M2d item 5: so is the server's own `retryable` flag (OD-R3, M1a-F1), when it is a boolean --
    // whether a retry is offered is the server's statement, not a guess from the HTTP status.
    // W-UI1-R2: the 424 ASSESSMENT_RECORD_INTEGRITY_ERROR's record_integrity only, rebuilt from the whitelist
    // (luRecordIntegrityWire) -- never the body's other fields, never as sent.
    const recordIntegrity = luRecordIntegrityWire(err.code, err.record_integrity);
    throw Object.assign(new Error(msg), {
      status: response.status,
      ...(typeof err.code === 'string' ? { code: err.code } : {}),
      ...(typeof err.failureClass === 'string' ? { failureClass: err.failureClass } : {}),
      ...(typeof err.reasonCode === 'string' ? { reasonCode: err.reasonCode } : {}),
      ...(typeof err.retryable === 'boolean' ? { retryable: err.retryable } : {}),
      ...(recordIntegrity ? { record_integrity: recordIntegrity } : {}),
    });
  }

  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  if (
    contentType?.includes('application/pdf') ||
    contentType?.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
    contentType?.includes('application/octet-stream')
  ) {
    return response.blob() as unknown as Promise<T>;
  }

  return response.text() as unknown as Promise<T>;
}

let refreshInFlight: Promise<{ accessToken: string; refreshToken: string }> | null = null;

export async function refreshAccessSession(): Promise<{ accessToken: string; refreshToken: string }> {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const result = await callApi<{ ok: boolean; accessToken: string; refreshToken: string }>(
      '/api/auth/refresh',
      {
        method: 'POST',
        auth: false,
        retryOnUnauthorized: false,
        body: { refreshToken },
      },
    );

    setSession({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      activeProjectId: getActiveProjectId() || undefined,
    });

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export async function callCore<T>(endpoint: string, options: ApiCallOptions = {}): Promise<T> {
  return callApi<T>(endpoint, options);
}
