﻿/**
 * notificationService.ts
 *
 * Stage-gate- och projektnotifieringar.
 *
 * Notiser levereras på två sätt:
 *  1. Alltid: loggad via appendDomainAudit med action="PROJECT_NOTIFICATION"
 *  2. Valfritt: via SMTP om SMTP_HOST + SMTP_USER + SMTP_PASS är konfigurerade
 *
 * SMTP-konfigurationsvariabler (lÃ¤gg till i .env.example):
 *   SMTP_HOST      â€” t.ex. smtp.sendgrid.net
 *   SMTP_PORT      â€” t.ex. 587
 *   SMTP_SECURE    â€” true/false
 *   SMTP_USER      â€” anvÃ¤ndarnamn
 *   SMTP_PASS      â€” lÃ¶senord
 *   NOTIFICATION_FROM_EMAIL â€” avsÃ¤ndaradress
 */

import { prisma } from '../db/prisma';
import { appendDomainAudit } from '../security/auditTrail';

export type NotificationEvent =
  | 'STAGE_GATE_PASSED'
  | 'STAGE_GATE_FAILED'
  | 'STAGE_GATE_BLOCKED'
  | 'MEMBER_ADDED'
  | 'MEMBER_REMOVED';

export interface ProjectNotification {
  projectId: string;
  event: NotificationEvent;
  gateId?: string;
  subjectUserId?: string;
  actingUserId: string;
  message: string;
}

// ─── SMTP-sändare (valfri) ───────────────────────────────────────────────────

let _transporter: unknown = null;

async function getTransporter() {
  if (_transporter !== null) return _transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    _transporter = false; // markera som "ej konfigurerat"
    return false;
  }

  try {
    // Dynamisk import av nodemailer (ej prod-beroende â€” installeras separat vid behov)
    // Use @vite-ignore to keep nodemailer optional (avoid Vite import-analysis resolution failures in tests/builds).
    const nm = (await import(/* @vite-ignore */ 'nodemailer').catch(() => null)) as null | {
      createTransport: (opts: object) => {
        sendMail: (opts: object) => Promise<unknown>;
      };
    };
    if (!nm) {
      _transporter = false;
      return false;
    }
    _transporter = nm.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
    return _transporter;
  } catch {
    _transporter = false;
    return false;
  }
}

interface EmailParams {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

async function sendSmtpEmail(params: EmailParams): Promise<boolean> {
  const transporter = await getTransporter();
  if (!transporter) return false;

  try {
    const from = process.env.NOTIFICATION_FROM_EMAIL ?? 'noreply@miljobeslut.se';
    const t = transporter as { sendMail: (opts: object) => Promise<unknown> };
    await t.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      text: params.body,
      attachments: params.attachments,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Skickar ett generiskt e-postmeddelande till en specifik mottagare.
 * Används för direkta utskick som inte är kopplade till projektmedlemmar.
 */
export async function sendEmailNotification(params: EmailParams): Promise<boolean> {
  const transporter = await getTransporter();
  if (!transporter) {
    // Logga att SMTP inte är konfigurerat om det behövs
    return false;
  }
  return sendSmtpEmail(params);
}

// ─── Publik API ───────────────────────────────────────────────────────────────

/**
 * Skicka projektnotis till alla projektmedlemmar.
 * Loggas alltid till AuditTrail; SMTP-e-post skickas om konfigurerat.
 */
export async function sendProjectNotification(notif: ProjectNotification): Promise<{
  auditId: string;
  emailsSent: number;
}> {
  // 1. Skriv till AuditTrail (in-memory + hash-chain)
  const auditRecord = await appendDomainAudit({
    entityType: 'PROJECT',
    entityId: notif.projectId,
    action: 'PROJECT_NOTIFICATION',
    userId: notif.actingUserId,
    payload: {
      event: notif.event,
      gateId: notif.gateId ?? null,
      subjectUserId: notif.subjectUserId ?? null,
      message: notif.message,
    },
  });

  // 2. HÃ¤mta e-postadresser fÃ¶r alla projektmedlemmar (om SMTP Ã¤r konfigurerat)
  const transporter = await getTransporter();
  if (!transporter) {
    return { auditId: auditRecord.id, emailsSent: 0 };
  }

  const members = await prisma.projectMember.findMany({
    where: { projectId: notif.projectId },
    include: {
      user: { select: { bankidId: true } },
    },
  });

  const eventLabel: Record<NotificationEvent, string> = {
    STAGE_GATE_PASSED: 'Stage Gate godkänd',
    STAGE_GATE_FAILED: 'Stage Gate underkänd',
    STAGE_GATE_BLOCKED: 'Stage Gate blockerad',
    MEMBER_ADDED: 'Projektmedlem tillagd',
    MEMBER_REMOVED: 'Projektmedlem borttagen',
  };

  const subject = `[Miljöbeslut] ${eventLabel[notif.event]} - projekt ${notif.projectId}`;

  let emailsSent = 0;
  for (const member of members) {
    // bankidId innehåller personnummer eller admin:xxx — försök parsa e-post ur metadata
    // I en riktig implementation hämtas e-post från User.email (fält kan läggas till i schema).
    // Här skickar vi bara om bankidId innehåller @-tecken (test/mock-scenario).
    const addr = member.user.bankidId.includes('@') ? member.user.bankidId : null;
    if (!addr) continue;
    const sent = await sendSmtpEmail({ to: addr, subject, body: notif.message });
    if (sent) emailsSent++;
  }

  return { auditId: auditRecord.id, emailsSent };
}

/**
 * Notifieringsfasad för stage-gate-evaluering.
 * Anropas automatiskt av stage-gate-routen efter en lyckad utvärdering.
 */
export async function notifyStageGate(params: {
  projectId: string;
  gateId: string;
  status: 'PASSED' | 'FAILED' | 'BLOCKED' | string;
  actingUserId: string;
}): Promise<void> {
  const event: NotificationEvent =
    params.status === 'PASSED'
      ? 'STAGE_GATE_PASSED'
      : params.status === 'FAILED'
        ? 'STAGE_GATE_FAILED'
        : 'STAGE_GATE_BLOCKED';

  const eventMessages: Record<NotificationEvent, string> = {
    STAGE_GATE_PASSED: `Stage Gate "${params.gateId}" har godkänts för projekt ${params.projectId}.`,
    STAGE_GATE_FAILED: `Stage Gate "${params.gateId}" underkändes för projekt ${params.projectId}. Åtgärd krävs.`,
    STAGE_GATE_BLOCKED: `Stage Gate "${params.gateId}" är blockerad för projekt ${params.projectId}. Granska villkor.`,
    MEMBER_ADDED: '',
    MEMBER_REMOVED: '',
  };

  await sendProjectNotification({
    projectId: params.projectId,
    event,
    gateId: params.gateId,
    actingUserId: params.actingUserId,
    message: eventMessages[event],
  });
}
