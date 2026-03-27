import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock docx ───────────────────────────────────────────────────────────────

const { mockPackerToBuffer } = vi.hoisted(() => ({
  mockPackerToBuffer: vi.fn().mockResolvedValue(Buffer.from('docx-content')),
}));

vi.mock('docx', () => {
  const Paragraph = vi.fn().mockImplementation(() => ({}));
  const TextRun = vi.fn().mockImplementation(() => ({}));
  const Document = vi.fn().mockImplementation(() => ({}));
  const Packer = { toBuffer: mockPackerToBuffer };
  const HeadingLevel = { HEADING_1: 'HEADING_1', HEADING_2: 'HEADING_2' };
  return { Document, Paragraph, TextRun, Packer, HeadingLevel };
});

import { buildPermitDocxBuffer } from '../../server/services/permitDocxExportService';

// ─────────────────────────────────────────────────────────────────────────────

describe('buildPermitDocxBuffer', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns a Buffer', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('hello'));
    const result = await buildPermitDocxBuffer({
      documentType: 'Villkorsbeslut',
      draftText: 'Verksamheten ska hålla ordning.',
    });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('calls Packer.toBuffer with a Document instance', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('x'));
    await buildPermitDocxBuffer({ documentType: 'Test', draftText: 'ska göras.' });
    const { Document } = await import('docx');
    expect(Document).toHaveBeenCalledOnce();
    expect(mockPackerToBuffer).toHaveBeenCalledOnce();
  });

  it('accepts an explicit generatedAt date', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('y'));
    const date = new Date('2024-01-15T10:00:00');
    const result = await buildPermitDocxBuffer({
      documentType: 'Rapport',
      draftText: 'Krav ska uppfyllas.',
      generatedAt: date,
    });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('handles empty draftText without throwing', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('empty'));
    await expect(
      buildPermitDocxBuffer({ documentType: 'Tom', draftText: '' })
    ).resolves.toBeDefined();
  });

  it('handles multi-line draftText with headings', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('multi'));
    const draftText = [
      '1. Villkor',
      'Verksamheten ska rapportera.',
      '## Avslutning',
      'Rapporten ska lämnas in.',
    ].join('\n');
    await expect(
      buildPermitDocxBuffer({ documentType: 'Beslut', draftText })
    ).resolves.toBeDefined();
    const { Paragraph } = await import('docx');
    expect(Paragraph).toHaveBeenCalled();
  });

  it('handles draftText with blank lines (empty paragraphs)', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('blank'));
    const draftText = 'Rad ett.\n\nRad tre.';
    await expect(
      buildPermitDocxBuffer({ documentType: 'X', draftText })
    ).resolves.toBeDefined();
  });

  it('handles Windows-style line endings (\\r\\n)', async () => {
    mockPackerToBuffer.mockResolvedValue(Buffer.from('crlf'));
    await expect(
      buildPermitDocxBuffer({ documentType: 'CRLF', draftText: 'ska\r\nska' })
    ).resolves.toBeDefined();
  });

  it('propagates Packer.toBuffer errors', async () => {
    mockPackerToBuffer.mockRejectedValue(new Error('packer-fail'));
    await expect(
      buildPermitDocxBuffer({ documentType: 'Fail', draftText: 'x' })
    ).rejects.toThrow('packer-fail');
  });
});
