export type PermitAuthorityStatus = 'SUBMITTED' | 'RECEIVED' | 'PENDING_REVIEW' | 'REJECTED';

export type PermitAuthorityFailureMode =
  | 'missing_endpoint'
  | 'timeout'
  | 'network'
  | 'http_4xx'
  | 'http_5xx'
  | null;

export interface PermitAuthorityAdapterInput {
  referenceId: string;
  caseNumber: string;
  submittedAt: string;
  projectId: string;
  orgId: string;
  authority: string;
  permitType: string;
  applicantName: string;
  propertyDesignation: string;
  documentIds: string[];
}

export interface PermitAuthorityAdapterResult {
  providerMode: 'unconfigured' | 'external' | 'mock';
  status: PermitAuthorityStatus;
  externalRef?: string;
  responseCode: number | null;
  rawStatus: string | null;
  failureMode: PermitAuthorityFailureMode;
}

interface AuthorityResponsePayload {
  ref?: string;
  referenceId?: string;
  externalRef?: string;
  caseNumber?: string;
  status?: string;
  state?: string;
  result?: string;
}

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function toInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function mapExternalStatus(rawStatus: string | null, responseCode: number): PermitAuthorityStatus {
  const normalized = trim(rawStatus).toUpperCase();
  if (normalized === 'SUBMITTED' || normalized === 'SENT' || normalized === 'QUEUED') return 'SUBMITTED';
  if (normalized === 'RECEIVED' || normalized === 'ACCEPTED') return 'RECEIVED';
  if (normalized === 'PENDING_REVIEW' || normalized === 'PENDING' || normalized === 'UNDER_REVIEW')
    return 'PENDING_REVIEW';
  if (normalized === 'REJECTED' || normalized === 'DENIED' || normalized === 'INVALID') return 'REJECTED';
  if (responseCode >= 200 && responseCode < 300) return 'SUBMITTED';
  if (responseCode >= 400 && responseCode < 500) return 'REJECTED';
  return 'PENDING_REVIEW';
}

function buildAuthHeaders(): Record<string, string> {
  const apiKey = trim(process.env.AUTHORITY_API_KEY);
  const bearerToken = trim(process.env.AUTHORITY_BEARER_TOKEN);
  const authMode = (trim(process.env.AUTHORITY_SUBMIT_AUTH_MODE) || '').toLowerCase();

  if (authMode === 'bearer') {
    return bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {};
  }
  if (authMode === 'x-api-key') {
    return apiKey ? { 'X-Api-Key': apiKey } : {};
  }
  if (authMode === 'none') {
    return {};
  }
  if (bearerToken) {
    return { Authorization: `Bearer ${bearerToken}` };
  }
  if (apiKey) {
    return { 'X-Api-Key': apiKey };
  }
  return {};
}

async function parseAuthorityResponse(response: Response): Promise<AuthorityResponsePayload> {
  const contentType = trim(response.headers.get('content-type')).toLowerCase();
  if (contentType.includes('application/json')) {
    return (await response.json()) as AuthorityResponsePayload;
  }

  const text = trim(await response.text());
  return text ? { ref: text } : {};
}

function getExternalReference(payload: AuthorityResponsePayload): string | undefined {
  return (
    trim(payload.ref) ||
    trim(payload.externalRef) ||
    trim(payload.referenceId) ||
    trim(payload.caseNumber) ||
    undefined
  );
}

export async function submitToConfiguredAuthority(
  input: PermitAuthorityAdapterInput,
): Promise<PermitAuthorityAdapterResult> {
  const endpoint = trim(process.env.AUTHORITY_SUBMIT_ENDPOINT);
  if (!endpoint) {
    // Mock-adapter: AUTHORITY_MOCK_MODE=true aktiverar ett deterministiskt
    // SUBMITTED-svar så E2E-flöden kan testas. Eftersom endast BankID får
    // mockas i produktion är mock-läget spärrat utanför dev/test.
    const mockRequested = trim(process.env.AUTHORITY_MOCK_MODE).toLowerCase() === 'true';
    const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();
    const mockAllowed = nodeEnv !== 'production';
    if (mockRequested && mockAllowed) {
      return {
        providerMode: 'mock',
        status: 'SUBMITTED',
        externalRef: `MOCK-${input.referenceId}`,
        responseCode: 202,
        rawStatus: 'MOCK_SUBMITTED',
        failureMode: null,
      };
    }
    return {
      providerMode: 'unconfigured',
      status: 'PENDING_REVIEW',
      responseCode: null,
      rawStatus: null,
      failureMode: 'missing_endpoint',
    };
  }

  const timeoutMs = toInt(process.env.AUTHORITY_SUBMIT_TIMEOUT_MS, 10_000, 1_000, 60_000);
  const maxRetries = toInt(process.env.AUTHORITY_SUBMIT_MAX_RETRIES, 1, 0, 3);
  const body = JSON.stringify({
    referenceId: input.referenceId,
    caseNumber: input.caseNumber,
    submittedAt: input.submittedAt,
    projectId: input.projectId,
    orgId: input.orgId,
    authority: input.authority,
    permitType: input.permitType,
    applicantName: input.applicantName,
    propertyDesignation: input.propertyDesignation,
    documentIds: input.documentIds,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildAuthHeaders(),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const payload = await parseAuthorityResponse(response);
      const rawStatus = trim(payload.status) || trim(payload.state) || trim(payload.result) || null;
      const mappedStatus = mapExternalStatus(rawStatus, response.status);

      if (response.ok) {
        return {
          providerMode: 'external',
          status: mappedStatus,
          externalRef: getExternalReference(payload),
          responseCode: response.status,
          rawStatus,
          failureMode: null,
        };
      }

      if (response.status >= 500 && attempt < maxRetries) {
        continue;
      }

      return {
        providerMode: 'external',
        status: response.status >= 400 && response.status < 500 ? 'REJECTED' : 'PENDING_REVIEW',
        externalRef: getExternalReference(payload),
        responseCode: response.status,
        rawStatus,
        failureMode: response.status >= 400 && response.status < 500 ? 'http_4xx' : 'http_5xx',
      };
    } catch (error) {
      const message = trim(error instanceof Error ? error.name : error);
      const isTimeout = message === 'TimeoutError' || message === 'AbortError';
      if (attempt < maxRetries) {
        continue;
      }

      return {
        providerMode: 'external',
        status: 'PENDING_REVIEW',
        responseCode: null,
        rawStatus: null,
        failureMode: isTimeout ? 'timeout' : 'network',
      };
    }
  }

  return {
    providerMode: 'external',
    status: 'PENDING_REVIEW',
    responseCode: null,
    rawStatus: null,
    failureMode: 'network',
  };
}
