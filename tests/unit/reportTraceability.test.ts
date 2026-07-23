import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildReportTraceability,
  formatTraceabilityFooter,
  formatTraceabilityKeywords,
} from '../../server/services/reportTraceability';
import { buildSimplePdfBuffer } from '../../server/services/pdfExportService';
import { resolveUnicodeFontPath, resetUnicodeFontCache } from '../../server/services/pdfUnicodeFont';

/** PDFKit stores Info strings as UTF-16BE with null pads — strip for asserts. */
function pdfInfoText(buf: Buffer): string {
  return buf.toString('latin1').replace(/\u0000/g, '');
}

describe('reportTraceability', () => {
  it('builds all legal traceability fields with fallbacks', () => {
    const meta = buildReportTraceability({
      operator: 'Ada Testsson',
      modelId: 'gemini-2.0-flash',
      datasetVersions: { topo10: 'vatten-v1', property: 'core.property_unit' },
      correlationId: 'corr-123',
      gitCommit: 'abc123def',
      dbMigrationVersion: '20260705212732_add_completed_project_status',
    });

    expect(meta.operator).toBe('Ada Testsson');
    expect(meta.modelId).toBe('gemini-2.0-flash');
    expect(meta.datasetVersions).toContain('topo10=vatten-v1');
    expect(meta.gitCommit).toBe('abc123def');
    expect(meta.dbMigrationVersion).toContain('20260705');
    expect(meta.correlationId).toBe('corr-123');

    const footer = formatTraceabilityFooter(meta);
    expect(footer).toContain('Op: Ada Testsson');
    expect(footer).toContain('Model: gemini-2.0-flash');
    expect(footer).toContain('Git: abc123def');
    expect(footer).toContain('Corr: corr-123');
    expect(formatTraceabilityKeywords(meta)).toBe(footer);
  });

  it('defaults missing fields safely', () => {
    const meta = buildReportTraceability({});
    expect(meta.operator).toBeTruthy();
    expect(meta.modelId).toBeTruthy();
    expect(meta.gitCommit).toBeTruthy();
    expect(meta.dbMigrationVersion).toBeTruthy();
    expect(meta.correlationId).toBe('n/a');
  });
});

describe('pdfExportService Swedish + traceability', () => {
  beforeEach(() => {
    resetUnicodeFontCache();
    process.env.PDF_UNICODE_FONT_PATH = 'C:\\Windows\\Fonts\\arial.ttf';
  });

  it('embeds Swedish letters and traceability footer in PDF text layer', async () => {
    const font = resolveUnicodeFontPath();
    expect(font, 'Unicode font should be available on this host').toBeTruthy();

    const buf = await buildSimplePdfBuffer({
      title: 'Miljöbeslut – översikt',
      subtitle: 'ÅÄÖ-test för juridisk rapport',
      body: 'Fastigheten Gävle Brynäs 1:1 ligger nära vattendrag. Skyddsnivå: hög.\n\nTabelldata verifieras via textlager.',
      traceability: {
        operator: 'Operatör Åsa',
        modelId: 'n/a',
        datasetVersions: ['topo10=vatten'],
        correlationId: 'pipe-corr-1',
        gitCommit: 'deadbeef',
        dbMigrationVersion: '20260512055145_init',
      },
    });

    expect(buf.length).toBeGreaterThan(500);
    const text = pdfInfoText(buf);
    expect(text).toContain('Miljöbeslut');
    expect(text).toContain('Op: Operatör Åsa');
    expect(text).toContain('Corr: pipe-corr-1');
    expect(text).toContain('Git: deadbeef');
    expect(text).toMatch(/ÅÄÖ|översikt|Gävle/);
  });
});
