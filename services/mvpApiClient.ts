const TOKEN_KEY = 'miljobeslut_admin_bearer';

function getToken() {
  if (typeof window === 'undefined') return '';
  return String(window.localStorage.getItem(TOKEN_KEY) || '').trim();
}

export async function callMvp<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: any;
    query?: Record<string, string | number | boolean>;
  } = {},
): Promise<T> {
  const method = options.method || 'POST';
  let url = endpoint;

  if (options.query) {
    const params = new URLSearchParams();
    Object.entries(options.query).forEach(([key, value]) => {
      params.append(key, String(value));
    });
    url += (url.includes('?') ? '&' : '?') + params.toString();
  }

  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options.body && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    throw new Error(`MVP API error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return response.text() as unknown as Promise<T>;
}
