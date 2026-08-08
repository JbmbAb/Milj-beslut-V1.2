import type {
  ExtractionResult,
  OcrPort,
  SourceArtifact,
} from '@miljobeslut/mps-text-projection';

export const EXTERNAL_OCR_ADAPTER_VERSION =
  process.env.OCR_ADAPTER_VERSION || 'ocr_external@endpoint-v1';

/**
 * TEXT-L2 OcrPort for OCR_ENDPOINT (Azure/etc).
 * Returns ExtractionResult only.
 */
export class ExternalOcrAdapter implements OcrPort {
  async ocr(_source: SourceArtifact, bytes: Uint8Array): Promise<ExtractionResult> {
    const endpoint = String(process.env.OCR_ENDPOINT || '').trim();
    const version = EXTERNAL_OCR_ADAPTER_VERSION;

    if (!endpoint) {
      return {
        text: '',
        method: 'ocr_external',
        version,
        succeeded: false,
        notes: 'OCR_ENDPOINT not configured',
      };
    }

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          ...(process.env.OCR_API_KEY
            ? { 'Ocp-Apim-Subscription-Key': process.env.OCR_API_KEY }
            : {}),
        },
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        return {
          text: '',
          method: 'ocr_external',
          version,
          succeeded: false,
          notes: `OCR_ENDPOINT HTTP ${resp.status}`,
        };
      }

      const json = (await resp.json()) as { text?: string };
      const text = String(json.text || '').trim();
      return {
        text,
        method: 'ocr_external',
        version,
        succeeded: text.length > 0,
        notes: text.length === 0 ? 'external OCR empty' : undefined,
      };
    } catch (err) {
      return {
        text: '',
        method: 'ocr_external',
        version,
        succeeded: false,
        notes: err instanceof Error ? err.message : 'external OCR failed',
      };
    }
  }
}

export function createExternalOcrAdapter(): OcrPort {
  return new ExternalOcrAdapter();
}
