/**
 * Low-level Gemini OCR HTTP client.
 * Used by GeminiOcrAdapter only — searchService re-exports for compatibility.
 */

export const OCR_MODEL = process.env.GEMINI_OCR_MODEL || process.env.OCR_MODEL || 'gemini-2.5-flash';
export const OCR_MAX_FILE_BYTES = Math.max(
  1_000_000,
  Number(process.env.SEARCH_OCR_MAX_FILE_BYTES || 12_000_000),
);

function extractSearchText(raw: string): string {
  return raw
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseGeminiText(payload: Record<string, unknown>): string {
  const candidates = Array.isArray(payload.candidates)
    ? (payload.candidates as Record<string, unknown>[])
    : [];
  const parts = candidates
    .map((candidate) => candidate?.content as Record<string, unknown> | undefined)
    .flatMap((content) =>
      Array.isArray(content?.parts) ? (content?.parts as Record<string, unknown>[]) : [],
    );
  const text = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n');
  return extractSearchText(text);
}

export async function runGeminiOcr(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return null;
  }
  if (fileBuffer.length > OCR_MAX_FILE_BYTES) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    OCR_MODEL,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: 'Extrahera all lasbar text ordagrant ur dokumentet. Returnera enbart textinnehall utan forklaringar.',
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: fileBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          topP: 0.1,
          maxOutputTokens: 8192,
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const text = parseGeminiText(payload);
    return text || null;
  } catch {
    return null;
  }
}
