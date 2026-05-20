import express from 'express';
import path from 'node:path';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { buildJsonPdfBuffer, buildSimplePdfBuffer } from '../services/pdfExportService';

const router = express.Router();
const MAX_PAYLOAD_CHARS = 600_000;

function safeFilenameBase(title: string, fallback: string): string {
  const raw = path.basename(String(title || '').trim()) || fallback;
  return raw.replace(/[^a-zA-Z0-9-_åäöÅÄÖ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback;
}

/**
 * Generisk PDF från JSON (t.ex. projektplan, logistik, miljöbedömning från befintliga generator-API).
 */
router.post('/api/export/pdf-json', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const title = String(req.body?.title || 'Rapport').trim().slice(0, 200) || 'Rapport';
    const subtitle =
      req.body?.subtitle != null ? String(req.body.subtitle).trim().slice(0, 500) : undefined;
    const payload = req.body?.json ?? req.body?.data;
    if (payload === undefined) {
      res.status(400).json({ ok: false, error: 'json eller data krävs i body.' });
      return;
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      res.status(400).json({ ok: false, error: 'Ogiltigt JSON-objekt.' });
      return;
    }
    if (serialized.length > MAX_PAYLOAD_CHARS) {
      res.status(413).json({ ok: false, error: 'Nyttolasten är för stor för PDF-export.' });
      return;
    }
    const buf = await buildJsonPdfBuffer(title, subtitle, payload);
    const base = safeFilenameBase(title, 'rapport');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.send(buf);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

/** Ren text-PDF (utkast från generator eller manuell text). */
router.post('/api/export/pdf-text', requireAuth, rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const title = String(req.body?.title || 'Dokument').trim().slice(0, 200) || 'Dokument';
    const subtitle =
      req.body?.subtitle != null ? String(req.body.subtitle).trim().slice(0, 500) : undefined;
    const body = String(req.body?.body ?? req.body?.text ?? '');
    if (!body.trim()) {
      res.status(400).json({ ok: false, error: 'body eller text krävs.' });
      return;
    }
    if (body.length > MAX_PAYLOAD_CHARS) {
      res.status(413).json({ ok: false, error: 'Texten är för lång.' });
      return;
    }
    const buf = await buildSimplePdfBuffer({ title, subtitle, body });
    const base = safeFilenameBase(title, 'dokument');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    res.send(buf);
  } catch (error: unknown) {
    res.status(500).json(toSafeErrorResponse(error));
  }
});

export default router;
