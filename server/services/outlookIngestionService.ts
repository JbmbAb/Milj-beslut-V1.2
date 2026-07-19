/**
 * outlookIngestionService.ts
 *
 * Idempotent pipeline for importing Outlook emails + attachments.
 * Re-runnable: message_id and SHA-256 attachment hash prevent all duplicates.
 *
 * Usage:
 *   import { runIngestion } from './outlookIngestionService';
 *   await runIngestion({ outlookFolder: 'C:/Users/.../Outlook data', storageRoot: 'D:/docs' });
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { prisma } from '../db/prisma';
import { logger } from '../logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RawEmail {
  messageId: string; // Outlook Message-ID header, e.g. <CAF43A12@kommun.se>
  sender: string;
  subject: string;
  receivedAt: Date;
  rawEmlPath?: string;
  attachments: RawAttachment[];
}

export interface RawAttachment {
  filename: string;
  data: Buffer;
}

export interface IngestionOptions {
  emails: RawEmail[]; // Caller provides parsed emails (from VBA export or node-mapi)
  storageRoot: string; // Folder where raw files are saved
  runId?: string; // Optional: override run ID (default: ISO date)
}

export interface IngestionResult {
  runId: string;
  emailsProcessed: number;
  emailsSkipped: number;
  attachmentsSaved: number;
  attachmentsSkipped: number;
  errors: string[];
}

// ─── Hash util ──────────────────────────────────────────────────────────────

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─── Core pipeline ─────────────────────────────────────────────────────────

export async function runIngestion(opts: IngestionOptions): Promise<IngestionResult> {
  const runId = opts.runId ?? `run_${new Date().toISOString().slice(0, 10)}`;
  const result: IngestionResult = {
    runId,
    emailsProcessed: 0,
    emailsSkipped: 0,
    attachmentsSaved: 0,
    attachmentsSkipped: 0,
    errors: [],
  };

  // Register pipeline run
  await prisma.pipelineRun.upsert({
    where: { runId },
    update: {
      runType: 'OUTLOOK_INGESTION',
      stageName: 'INGEST_EMAILS',
      status: 'RUNNING',
      finishedAt: null,
      processedCount: 0,
      errorCount: 0,
      notes: null,
    },
    create: {
      runId,
      runType: 'OUTLOOK_INGESTION',
      stageName: 'INGEST_EMAILS',
    },
  });

  for (const email of opts.emails) {
    try {
      // ── STEP 1: Idempotency check on message_id ──────────────────────────
      const existing = await prisma.emailMessage.findUnique({
        where: { messageId: email.messageId },
      });

      if (existing && existing.status === 'COMPLETE') {
        result.emailsSkipped++;
        continue;
      }

      // ── STEP 2: Upsert email metadata ────────────────────────────────────
      await prisma.emailMessage.upsert({
        where: { messageId: email.messageId },
        update: { status: 'NEW' },
        create: {
          messageId: email.messageId,
          sender: email.sender,
          subject: email.subject,
          receivedAt: email.receivedAt,
          rawEmlPath: email.rawEmlPath ?? null,
          runId,
          status: 'NEW',
        },
      });

      result.emailsProcessed++;

      // ── STEP 3: Process attachments ──────────────────────────────────────
      for (const att of email.attachments) {
        try {
          const hash = sha256(att.data);

          // Check if attachment already stored
          const existingAtt = await prisma.outlookAttachment.findUnique({
            where: { attachmentHash: hash },
          });

          if (existingAtt) {
            result.attachmentsSkipped++;
            continue;
          }

          // Save file to disk
          const dir = path.join(opts.storageRoot, runId, email.messageId.replace(/[<>:"/\\|?*]/g, '_'));
          fs.mkdirSync(dir, { recursive: true });
          const storedPath = path.join(dir, att.filename);
          fs.writeFileSync(storedPath, att.data);

          // Upsert attachment record
          await prisma.outlookAttachment.upsert({
            where: { attachmentHash: hash },
            update: {},
            create: {
              attachmentHash: hash,
              canonicalMessageId: email.messageId,
              filename: att.filename,
              filesize: BigInt(att.data.length),
              checksumSha256: hash,
              storedPath,
              parsed: false,
            },
          });

          result.attachmentsSaved++;
        } catch (attErr: any) {
          result.errors.push(`Attachment error [${att.filename}]: ${attErr.message}`);
        }
      }

      // ── STEP 4: Mark email as attachments extracted ───────────────────────
      await prisma.emailMessage.update({
        where: { messageId: email.messageId },
        data: { status: 'ATTACHMENTS_EXTRACTED', processedAt: new Date() },
      });
    } catch (emailErr: any) {
      result.errors.push(`Email error [${email.messageId}]: ${emailErr.message}`);
    }
  }

  // ── STEP 5: Finalise run record ──────────────────────────────────────────
  await prisma.pipelineRun.update({
    where: { runId },
    data: {
      finishedAt: new Date(),
      status: result.errors.length ? 'FAILED' : 'SUCCESS',
      processedCount: result.emailsProcessed,
      errorCount: result.errors.length,
      notes: [
        `emailsSkipped=${result.emailsSkipped}`,
        `attachmentsSaved=${result.attachmentsSaved}`,
        `attachmentsSkipped=${result.attachmentsSkipped}`,
        result.errors.length ? result.errors.join('\n') : null,
      ]
        .filter(Boolean)
        .join('\n'),
    },
  });

  return result;
}

/**
 * Returns all attachments pending text extraction, ordered by creation date.
 */
export async function getPendingAttachments(limit = 100) {
  return prisma.outlookAttachment.findMany({
    where: { parsed: false },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/**
 * Marks an attachment as parsed and stores the extracted text.
 */
export async function markAttachmentParsed(hash: string, extractedText: string) {
  return prisma.outlookAttachment.update({
    where: { attachmentHash: hash },
    data: { parsed: true, extractedText },
  });
}

/**
 * Marks an attachment as failed.
 */
export async function markAttachmentFailed(hash: string, reason: string) {
  logger.warn('outlook-ingestion: attachment parse failed', { hash, reason });
  return prisma.outlookAttachment.update({
    where: { attachmentHash: hash },
    data: { parsed: true, parseFailureReason: reason },
  });
}
