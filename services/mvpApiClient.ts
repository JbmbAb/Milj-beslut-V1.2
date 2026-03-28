// services/mvpApiClient.ts
const TOKEN_KEY = 'miljobeslut_admin_bearer';

export function getToken() {
    return String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
}

export async function callMvp<T>(endpoint: string, options: { method?: string; body?: any; query?: Record<string, any> } = {}): Promise<T> {
    const { method = 'POST', body, query } = options;
    const token = getToken();

    let url = endpoint;
    if (query) {
        const params = new URLSearchParams();
        Object.entries(query).forEach(([k, v]) => {
            if (v !== undefined) params.append(k, String(v));
        });
        url += '?' + params.toString();
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const contentType = res.headers.get('content-type');
    if (contentType?.includes('application/json')) {
        return res.json() as Promise<T>;
    }

    if (contentType?.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || contentType?.includes('application/octet-stream')) {
        return res.blob() as unknown as Promise<T>;
    }

    return res.text() as unknown as Promise<T>;
}
