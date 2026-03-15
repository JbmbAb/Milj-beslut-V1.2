// services/mvpApiClient.ts
const TOKEN_KEY = 'miljobeslut_admin_bearer';
const DEMO_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vLXVzZXItaWQiLCJvcmdhbmlzYXRpb25JZCI6ImNtbTR4dnU5ODAwMDBjdWg0dmowdXN6MDkiLCJiYW5raWRJZCI6ImRlbW8tYmFua2lkIiwicm9sZSI6IkFETUlOIiwidHlwZSI6ImFjY2VzcyIsImp0aSI6ImRlbW8tanRpLTE3NDEyOTQwOTIiLCJpYXQiOjE3NDEyOTQwOTIsImV4cCI6MTgwNDQyMzY5MX0.YiCAlEkfJS0zQH-L_ia9Z95ZwIdDq201hb1OK5ciHHU';

export function getToken() {
    return String(window.localStorage.getItem(TOKEN_KEY) || DEMO_TOKEN).trim();
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
