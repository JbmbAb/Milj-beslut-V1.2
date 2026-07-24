import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeExternalText } from '../../../utils/textEncoding';

export interface ExtractedCorpusContent {
  contentHash: string;
  byteSize: number;
  formatHint: string;
  mimeType: string;
  detectedTitle?: string;
  detectedSummary?: string;
  documentText?: string;
}

export interface ExtractCorpusContentOptions {
  extractPdfText?: boolean;
}

export async function extractCorpusContent(
  filePath: string,
  explicitMimeType?: string | null,
  options: ExtractCorpusContentOptions = {},
): Promise<ExtractedCorpusContent> {
  const buffer = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const formatHint = extension.replace(/^\./, '') || 'bin';
  const mimeType = explicitMimeType || inferMimeType(extension);
  const contentHash = createHash('sha256').update(buffer).digest('hex');
  const extractPdfText = options.extractPdfText ?? true;

  if (extension === '.pdf') {
    const documentText = extractPdfText ? await extractPdfBufferText(buffer) : undefined;
    return {
      contentHash,
      byteSize: buffer.byteLength,
      formatHint,
      mimeType,
      documentText,
    };
  }

  const text = decodeTextBuffer(buffer);

  if (extension === '.json') {
    return {
      contentHash,
      byteSize: buffer.byteLength,
      formatHint,
      mimeType,
      documentText: extractJsonDocumentText(text),
    };
  }

  if (extension === '.html' || extension === '.htm') {
    const html = extractHtmlDocumentText(text);
    return {
      contentHash,
      byteSize: buffer.byteLength,
      formatHint,
      mimeType,
      detectedTitle: html.title,
      detectedSummary: html.summary,
      documentText: html.documentText,
    };
  }

  if (extension === '.xml' || extension === '.bin') {
    return {
      contentHash,
      byteSize: buffer.byteLength,
      formatHint,
      mimeType,
      documentText: extractMarkupDocumentText(text),
    };
  }

  return {
    contentHash,
    byteSize: buffer.byteLength,
    formatHint,
    mimeType,
    documentText: normalizeExternalText(text),
  };
}

function inferMimeType(extension: string): string {
  switch (extension) {
    case '.html':
    case '.htm':
      return 'text/html';
    case '.xml':
      return 'application/xml';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  const latin1 = buffer.toString('latin1');
  const utf8LooksBroken = /�/.test(utf8);
  return utf8LooksBroken && !/�/.test(latin1) ? latin1 : utf8;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function extractMarkupDocumentText(input: string): string | undefined {
  const withoutComments = input.replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutTags = withoutComments.replace(/<[^>]+>/g, ' ');
  return normalizeExternalText(decodeHtmlEntities(withoutTags));
}

function extractHtmlDocumentText(input: string): {
  title?: string;
  summary?: string;
  documentText?: string;
} {
  const titleMatch = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const summaryMatch = input.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
  );
  const body = input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  return {
    title: normalizeExternalText(decodeHtmlEntities(titleMatch?.[1] || '')),
    summary: normalizeExternalText(decodeHtmlEntities(summaryMatch?.[1] || '')),
    documentText: extractMarkupDocumentText(body),
  };
}

function extractJsonDocumentText(input: string): string | undefined {
  try {
    const parsed = JSON.parse(input) as unknown;
    return normalizeExternalText(flattenJsonValues(parsed).join(' '));
  } catch {
    return normalizeExternalText(input);
  }
}

function flattenJsonValues(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenJsonValues(item));
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => [
      key,
      ...flattenJsonValues(nested),
    ]);
  }
  return [];
}

async function extractPdfBufferText(buffer: Buffer): Promise<string | undefined> {
  try {
    const pdfParseModule = await import('pdf-parse');
    
    // Check if it's the modern class-based pdf-parse (e.g. mehmet-kozan/pdf-parse)
    if ('PDFParse' in pdfParseModule && typeof pdfParseModule.PDFParse === 'function') {
      const PDFParseClass = pdfParseModule.PDFParse as any;
      const uint8Array = new Uint8Array(buffer);
      const parser = new PDFParseClass(uint8Array);
      await parser.load();
      const result = await parser.getText();
      return normalizeExternalText(result?.text);
    }
    
    // Fallback to legacy function-based pdf-parse
    const pdfParse =
      (pdfParseModule as any).default ??
      (pdfParseModule as any);
    const parsed = await pdfParse(buffer);
    return normalizeExternalText(parsed?.text);
  } catch (err: any) {
    console.error('Error in extractPdfBufferText:', err.message);
    return undefined;
  }
}
