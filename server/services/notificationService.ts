/**
 * notificationService.ts
 *
 * Stage-gate och projektnotifieringar.
 *
 * Notiser levereras pÃ¥ tvÃ¥ sÃ¤tt:
 *  1. Alltid: loggad via appendDomainAudit med action="PROJECT_NOTIFICATION"
 *  2. Valfritt: via SMTP om SMTP_HOST + SMTP_USER + SMTP_PASS Ã¤r konfigurerade
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

// â”€â”€ SMTP-sÃ¤ndare (valfri) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    const nm = await import(/* @vite-ignore */ 'nodemailer').catch(() => null) as null | {
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

async function sendSmtpEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const transporter = await getTransporter();
  if (!transporter) return false;

  try {
    const from = process.env.NOTIFICATION_FROM_EMAIL ?? 'noreply@miljobeslut.se';
    const t = transporter as { sendMail: (opts: object) => Promise<unknown> };
    await t.sendMail({ from, ...params });
    return true;
  } catch {
    return false;
  }
}

// â”€â”€ Publik API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    STAGE_GATE_PASSED: 'Stage Gate godkÃ¤nd',
    STAGE_GATE_FAILED: 'Stage Gate underkÃ¤nd',
    STAGE_GATE_BLOCKED: 'Stage Gate blockerad',
    MEMBER_ADDED: 'Projektmedlem tillagd',
    MEMBER_REMOVED: 'Projektmedlem borttagen',
  };

  const subject = `[MiljÃ¶beslut] ${eventLabel[notif.event]} â€” projekt ${notif.projectId}`;

  let emailsSent = 0;
  for (const member of members) {
    // bankidId innehÃ¥ller personnummer eller admin:xxx â€” fÃ¶rsÃ¶k parsa e-post ur metadata
    // I en riktig implementation hÃ¤mtas e-post frÃ¥n User.email (fÃ¤lt kan lÃ¤ggas till i schema).
    // HÃ¤r skickar vi bara om bankidId innehÃ¥ller @-tecken (test/mock-scenario).
    const addr = member.user.bankidId.includes('@') ? member.user.bankidId : null;
    if (!addr) continue;
    const sent = await sendSmtpEmail({ to: addr, subject, text: notif.message });
    if (sent) emailsSent++;
  }

  return { auditId: auditRecord.id, emailsSent };
}

/**
 * Notifieringsfacade fÃ¶r stage-gate-evaluering.
 * Anropas automatiskt av stage-gate-routen efter en lyckad utvÃ¤rdering.
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
    STAGE_GATE_PASSED: `Stage Gate "${params.gateId}" har godkÃ¤nts fÃ¶r projekt ${params.projectId}.`,
    STAGE_GATE_FAILED: `Stage Gate "${params.gateId}" underkÃ¤ndes fÃ¶r projekt ${params.projectId}. Ã…tgÃ¤rd krÃ¤vs.`,
    STAGE_GATE_BLOCKED: `Stage Gate "${params.gateId}" Ã¤r blockerad fÃ¶r projekt ${params.projectId}. Granska villkor.`,
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
