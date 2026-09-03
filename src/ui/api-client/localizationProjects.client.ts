/**
 * PRODUCT-LU-PROPERTY-FIRST-WORKFLOW-01 Phase B (UI wiring).
 * Client for the property-first project discovery/creation/bootstrap-status endpoints added in
 * PRODUCT-LU-PROJECT-CONTEXT-BOOTSTRAP-01 Phase B. This is the ONLY client the property-first UI
 * flow may use to create a localization project -- it never touches /api/admin/projects or any
 * admin-only project-creation path.
 */
import { callApi } from '../../../services/coreApiClient';

export interface LocalizationProjectListItem {
  readonly id: string;
  readonly name: string | null;
  readonly propertyDesignation: string;
  readonly status: string;
  readonly createdAt: string;
}

export interface CanonicalPropertyCandidate {
  readonly sourceKey: string;
  readonly sourceDataset: string;
  readonly designation: string;
  readonly municipality: string | null;
  readonly municipalityCode: string | null;
  readonly countyCode: string | null;
  readonly matchKind: 'exact' | 'fuzzy';
}

export interface BootstrapStatus {
  readonly id: string;
  readonly projectId: string;
  readonly propertyDesignation: string;
  readonly status: 'PENDING' | 'LEASED' | 'COMPLETED' | 'FAILED';
  readonly contextBindingArtifactId: string | null;
  readonly failureCode: string | null;
  readonly failureDetail: string | null;
  readonly createdAt?: string;
}

export interface BootstrapStatusDiagnostics {
  readonly code: 'WORKER_LIKELY_UNAVAILABLE' | 'WORKER_NOT_CONFIGURED';
  readonly message: string;
  readonly staleForMs: number;
  readonly workerStartCommand: string;
  readonly projectContextWorkerConfigured: boolean;
}

export interface BootstrapStatusResponse {
  readonly status: BootstrapStatus;
  readonly diagnostics: BootstrapStatusDiagnostics | null;
  readonly runtime?: {
    readonly webHasProjectContextSigningKey: boolean;
    readonly workerStartCommand: string;
  };
}

export async function listPropertyProjects(propertyDesignation: string): Promise<LocalizationProjectListItem[]> {
  const result = await callApi<{ ok: boolean; projects: LocalizationProjectListItem[] }>(
    '/api/localization/property-projects',
    { method: 'GET', query: { propertyDesignation } },
  );
  return result.projects;
}

export async function searchCanonicalPropertyCandidates(query: string): Promise<CanonicalPropertyCandidate[]> {
  const result = await callApi<{ ok: boolean; candidates: CanonicalPropertyCandidate[] }>(
    '/api/localization/property-candidates',
    { method: 'GET', query: { query } },
  );
  return result.candidates;
}

export async function createLocalizationProjectRequest(input: {
  readonly property: Pick<CanonicalPropertyCandidate, 'sourceKey' | 'sourceDataset' | 'designation'>;
  readonly name: string;
}): Promise<{ project: LocalizationProjectListItem; bootstrapRequestId: string; bootstrapStatus: BootstrapStatus['status'] }> {
  return callApi('/api/localization/localization-projects', {
    method: 'POST',
    body: { property: input.property, name: input.name },
  });
}

export async function getBootstrapStatus(projectId: string): Promise<BootstrapStatusResponse | null> {
  try {
    const result = await callApi<{ ok: boolean; status: BootstrapStatus; diagnostics: BootstrapStatusDiagnostics | null; runtime?: BootstrapStatusResponse['runtime'] }>(
      `/api/localization/${encodeURIComponent(projectId)}/bootstrap-status`,
      { method: 'GET' },
    );
    return {
      status: result.status,
      diagnostics: result.diagnostics ?? null,
      runtime: result.runtime,
    };
  } catch (error) {
    // No bootstrap request exists yet for this project -- not an error the caller should
    // surface as a failure, just "nothing to report". Matched on the server's own message text
    // (server/routes/localization.routes.ts's bootstrap-status 404 body) since callApi does not
    // expose the HTTP status code on the thrown error.
    if (error instanceof Error && /no bootstrap request exists/i.test(error.message)) return null;
    throw error;
  }
}

export async function retryLocalizationBootstrap(projectId: string): Promise<{ bootstrapRequestId: string; bootstrapStatus: BootstrapStatus['status'] }> {
  return callApi(`/api/localization/${encodeURIComponent(projectId)}/bootstrap-retry`, { method: 'POST' });
}
