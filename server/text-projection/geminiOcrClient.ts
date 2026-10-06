/**
 * Gemini OCR is retired. Digital PDFs still go through pdf-parse.
 * This function stays so existing callers fail closed without a network call.
 */

export const OCR_MODEL = 'retired-gemini-ocr';
export const OCR_MAX_FILE_BYTES = Math.max(
  1_000_000,
  Number(process.env.SEARCH_OCR_MAX_FILE_BYTES || 12_000_000),
);

export async function runGeminiOcr(
  _fileBuffer: Buffer,
  _mimeType: string,
): Promise<string | null> {
  return null;
}
