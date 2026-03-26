import { describe, expect, it } from 'vitest';

// ─── Mock docx ────────────────────────────────────────────────────────────────
// permitDocxExportService uses docx + Packer.toBuffer which is complex to run
// in test environment – mock it to return a deterministic Buffer.

vi.mock('docx', () => {
  const Paragraph = vi.fn(function(this: Record<string, unknown>, _arg: unknown) {});
  const TextRun = vi.fn(function(this: Record<string, unknown>, _arg: unknown) {});
  const Document = vi.fn(function(this: Record<string, unknown>, _arg: unknown) {});

  return {
    Document,
    HeadingLevel: { HEADING_1: 1, HEADING_2: 2 },
    Packer: {
      toBuffer: vi.fn().mockResolvedValue(Buffer.from('MOCK-DOCX-CONTENT')),
    },
    Paragraph,
    TextRun,
  };
});

import { vi } from 'vitest';
import { buildPermitDocxBuffer } from '../../server/services/permitDocxExportService';
import { Packer } from 'docx';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('permitDocxExportService – buildPermitDocxBuffer', () => {

  // ── Return type ───────────────────────────────────────────────────────────

  it('returns a Buffer', async () => {
    const result = await buildPermitDocxBuffer({
      documentType: 'Miljötillstånd',
      draftText: 'Avsnitt 1\nText här',
    });

    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('resolves (does not throw) with minimal input', async () => {
    await expect(
      buildPermitDocxBuffer({ documentType: 'Test', draftText: '' }),
    ).resolves.toBeDefined();
  });

  // ── Packer.toBuffer called ─────────────────────────────────────────────────

  it('calls Packer.toBuffer exactly once per invocation', async () => {
    (Packer.toBuffer as ReturnType<typeof vi.fn>).mockClear();

    await buildPermitDocxBuffer({
      documentType: 'Miljötillstånd',
      draftText: 'Draft text',
    });

    expect(Packer.toBuffer).toHaveBeenCalledTimes(1);
  });

  it('calls Packer.toBuffer with a Document instance', async () => {
    (Packer.toBuffer as ReturnType<typeof vi.fn>).mockClear();

    await buildPermitDocxBuffer({
      documentType: 'Anmälan',
      draftText: '## Rubrik\nText',
    });

    const call = (Packer.toBuffer as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBeDefined(); // Document object passed
  });

  // ── Multi-line draft handling ──────────────────────────────────────────────

  it('does not throw on multi-line draftText with headings', async () => {
    await expect(
      buildPermitDocxBuffer({
        documentType: 'Tillstånd',
        draftText: '1. Avsnitt ett\nNormal text\n2. Avsnitt två\n\nTom rad',
      }),
    ).resolves.toBeDefined();
  });

  it('does not throw on empty draftText', async () => {
    await expect(
      buildPermitDocxBuffer({ documentType: 'Empty', draftText: '' }),
    ).resolves.toBeDefined();
  });

  it('does not throw when generatedAt is provided', async () => {
    await expect(
      buildPermitDocxBuffer({
        documentType: 'Med datum',
        draftText: 'Innehåll',
        generatedAt: new Date('2024-07-01T12:00:00Z'),
      }),
    ).resolves.toBeDefined();
  });
});
