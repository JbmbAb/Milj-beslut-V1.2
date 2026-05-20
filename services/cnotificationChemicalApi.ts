import { csrfFetch } from './csrfClient';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

export type CNotificationChemicalDto = {
  id: string;
  organisationId: string;
  projectId: string | null;
  name: string;
  annualConsumption: string | null;
  storageNote: string | null;
  hazardCode: string | null;
  requiresSafetyDataSheet: boolean;
  reviewStatus: string;
  createdAt: string;
  updatedAt: string;
};

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? (window.localStorage.getItem(TOKEN_KEY) ?? '') : '';
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function listCNotificationChemicals(projectId?: string): Promise<CNotificationChemicalDto[]> {
  const q = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await csrfFetch(`/api/admin/c-notification/chemicals${q}`, {
    method: 'GET',
    headers: authHeaders(),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { chemicals: CNotificationChemicalDto[] };
  return data.chemicals ?? [];
}

export async function createCNotificationChemical(input: {
  name: string;
  annualConsumption?: string;
  storageNote?: string;
  hazardCode?: string;
  requiresSafetyDataSheet?: boolean;
  projectId?: string;
}): Promise<CNotificationChemicalDto> {
  const res = await csrfFetch('/api/admin/c-notification/chemicals', {
    method: 'POST',
    headers: authHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
  const data = (await res.json()) as { chemical: CNotificationChemicalDto };
  return data.chemical;
}

export async function deleteCNotificationChemical(id: string): Promise<void> {
  const res = await csrfFetch(`/api/admin/c-notification/chemicals/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(),
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${res.status}`);
  }
}
