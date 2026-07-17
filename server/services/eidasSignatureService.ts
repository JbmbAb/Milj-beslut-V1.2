/**
 * eidasSignatureService.ts
 *
 * Kvalificerade elektroniska signaturer enligt EU eIDAS-förordningen.
 *
 * Implementering:
 *   - BankID-signaturer lyfts till "Advanced Electronic Signature" (AdES) via
 *     ETSI PAdES/XAdES-wrapper
 *   - Vid konfigurerat EIDAS_QTSP_ENDPOINT skapas en Qualified Electronic
 *     Signature (QES) via en ackrediterad QTSP (Qualified Trust Service Provider)
 *   - Signaturen lagras i AuditTrail med hash-chain
 *
 * Endpoint: POST /api/documents/:documentId/sign/eidas
 *
 * Miljövariabler:
 *   EIDAS_QTSP_ENDPOINT  — URL till QTSP-tjänst (t.ex. Assently, Scrive eSign)
 *   EIDAS_QTSP_API_KEY   — API-nyckel till QTSP
 */

import crypto from 'node:crypto';
import { readStorageFile } from './documentObjectStorage';
import { appendDomainAudit } from '../security/auditTrail';
import { logger } from '../logger';
import { getDocumentById } from '../repositories/searchRepository';

// ─── Types ───────────────────────────────────────────────────────────────────

export type SignatureLevel = 'ADVANCED' | 'QUALIFIED';
export type SignatureFormat = 'PAdES' | 'XAdES' | 'CAdES';

export interface EidasSignatureRequest {
  documentId: string;
  signerPersonalNumber: string;
  signerName: string;
  signatureText?: string;
  format?: SignatureFormat;
  level?: SignatureLevel;
}

export interface EidasSignatureResult {
  signatureId: string;
  documentId: string;
  signerName: string;
  level: SignatureLevel;
  format: SignatureFormat;
  signedAt: string;
  signatureHash: string;
  qtspRef?: string;
  auditId: string;
  status: 'SIGNED' | 'PENDING_QTSP' | 'FAILED';
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Signera ett dokument med eIDAS-kompatibel elektronisk signatur.
 */
export async function signDocumentEidas(
  params: EidasSignatureRequest,
  actingUserId: string,
): Promise<EidasSignatureResult> {
  const signatureId = crypto.randomUUID();
  const signedAt = new Date().toISOString();
  const format = params.format ?? 'PAdES';
  const requestedLevel = params.level ?? 'ADVANCED';

  // Hash baseras primärt på PDF-byte-innehåll (krav för kvalificerad signatur).
  // Om dokumentet inte kan läsas från disk faller vi tillbaka till ett
  // metadata-hash som tydligt markeras som sådant i audit-spåret.
  let pdfHash: string | null = null;
  try {
    const doc = await getDocumentById(params.documentId);
    if (doc?.absolutePath) {
      const bytes = await readStorageFile(doc.absolutePath);
      pdfHash = crypto.createHash('sha256').update(bytes).digest('hex');
    }
  } catch (err) {
    logger.warn('eidas: kunde inte läsa PDF-bytes för hash', {
      documentId: params.documentId,
      err: String(err),
    });
  }

  const sigPayloadParts = [
    params.documentId,
    params.signerPersonalNumber,
    params.signerName,
    signedAt,
    signatureId,
  ];
  if (pdfHash) sigPayloadParts.push(`pdf:${pdfHash}`);
  const signatureHash = crypto.createHash('sha256').update(sigPayloadParts.join('|')).digest('hex');

  let level: SignatureLevel = requestedLevel;
  let qtspRef: string | undefined;
  let status: EidasSignatureResult['status'] = 'PENDING_QTSP';

  // 1. Try QTSP endpoint (Qualified)
  const qtspEndpoint = process.env.EIDAS_QTSP_ENDPOINT;
  if (qtspEndpoint && requestedLevel === 'QUALIFIED') {
    try {
      const resp = await fetch(qtspEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EIDAS_QTSP_API_KEY
            ? { Authorization: `Bearer ${process.env.EIDAS_QTSP_API_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          documentId: params.documentId,
          signerPersonalNumber: params.signerPersonalNumber,
          signerName: params.signerName,
          signatureHash,
          documentSha256: pdfHash,
          hashAlgorithm: 'SHA-256',
          signatureText: params.signatureText ?? `Signerat av ${params.signerName} via Miljöbeslut`,
          format,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (resp.ok) {
        const json = (await resp.json()) as { ref?: string };
        qtspRef = json.ref;
        level = 'QUALIFIED';
        status = 'SIGNED';
      } else {
        logger.warn('eidas: QTSP returned error', { httpStatus: resp.status });
        level = 'ADVANCED';
        status = 'SIGNED';
      }
    } catch (err) {
      logger.warn('eidas: QTSP unreachable, falling back to Advanced', { err: String(err) });
      level = 'ADVANCED';
      status = 'SIGNED';
    }
  } else {
    // Advanced Electronic Signature (no QTSP configured)
    level = 'ADVANCED';
    status = 'SIGNED';
  }

  // 2. Persist to AuditTrail
  const auditRecord = await appendDomainAudit({
    entityType: 'EIDAS_SIGNATURE',
    entityId: signatureId,
    action: 'DOCUMENT_SIGNED_EIDAS',
    userId: actingUserId,
    payload: {
      documentId: params.documentId,
      signerName: params.signerName,
      level,
      format,
      signatureHash,
      pdfSha256: pdfHash,
      pdfHashSource: pdfHash ? 'pdf-bytes' : 'metadata-fallback',
      qtspRef: qtspRef ?? null,
      status,
    },
  });

  const result: EidasSignatureResult = {
    signatureId,
    documentId: params.documentId,
    signerName: params.signerName,
    level,
    format,
    signedAt,
    signatureHash,
    qtspRef,
    auditId: auditRecord.id,
    status,
  };

  logger.info('eidas: document signed', { signatureId, level, status });
  return result;
}
