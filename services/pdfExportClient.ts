import { csrfFetch } from './csrfClient';

const TOKEN_KEY = 'miljobeslut_admin_bearer';

export function getAdminBearer(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function parseFilenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const basic = /filename="?([^"]+)"?/i.exec(header);
  if (!basic?.[1]) return fallback;
  try {
    return decodeURIComponent(basic[1]);
  } catch {
    return basic[1];
  }
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Hämtar PDF från POST /api/export/pdf-json (kräver inloggning + CSRF).
 */
export async function downloadPdfFromJson(options: {
  title: string;
  subtitle?: string;
  json: unknown;
  fallbackFilename?: string;
}): Promise<void> {
  const token = getAdminBearer();
  const res = await csrfFetch('/api/export/pdf-json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      title: options.title,
      subtitle: options.subtitle,
      json: options.json,
    }),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const blob = await res.blob();
  const filename = parseFilenameFromContentDisposition(
    res.headers.get('content-disposition'),
    options.fallbackFilename ?? 'rapport.pdf',
  );
  triggerBrowserDownload(blob, filename);
}
