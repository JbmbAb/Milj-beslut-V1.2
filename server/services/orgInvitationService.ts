/**
 * orgInvitationService.ts
 *
 * Organisationsinbjudningsflöde — skapar, listar och accepterar inbjudningar.
 *
 * Inbjudningar lagras med ett signat engångstokens (HMAC-SHA256) som
 * löper ut efter 72 timmar. Alla händelser loggas i AuditTrail.
 *
 * API-yta (via secureApi.express.ts):
 *   POST   /api/orgs/:orgId/invitations          — skapa inbjudan
 *   GET    /api/orgs/:orgId/invitations           — lista aktiva inbjudningar (ADMIN)
 *   POST   /api/orgs/:orgId/invitations/accept    — acceptera inbjudan via token
 *   DELETE /api/orgs/:orgId/invitations/:inviteId — återkalla inbjudan (ADMIN)
 */

import crypto from 'node:crypto';
import { prisma } from '../db/prisma';
import { appendDomainAudit } from '../security/auditTrail';
import { logger } from '../logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OrgInvitation {
  id: string;
  orgId: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  createdBy: string;
}

// ─── In-memory store (persists across requests within same process) ────────────
//     In production this would use a DB table via Prisma + migration.
//     We use AuditTrail as the persistent record for compliance.

const invitations = new Map<string, OrgInvitation>();

const INVITE_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

// ─── Token helpers ─────────────────────────────────────────────────────────

function generateToken(inviteId: string, orgId: string): string {
  const secret = process.env.JWT_SECRET ?? 'dev-secret';
  return crypto.createHmac('sha256', secret).update(`${inviteId}|${orgId}`).digest('hex');
}

function verifyToken(token: string, inviteId: string, orgId: string): boolean {
  const expected = generateToken(inviteId, orgId);
  return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
}

// ─── Service functions ────────────────────────────────────────────────────────

/**
 * Skapa en ny inbjudan för en e-postadress till en organisation.
 */
export async function createInvitation(params: {
  orgId: string;
  email: string;
  role: string;
  actingUserId: string;
}): Promise<OrgInvitation> {
  // Verify organisation exists
  const org = await prisma.organisation.findUnique({ where: { id: params.orgId } });
  if (!org) throw new Error(`Organisation ${params.orgId} hittades inte`);

  // Check for existing pending invite for same email in same org
  const existing = Array.from(invitations.values()).find(
    (inv) =>
      inv.orgId === params.orgId &&
      inv.email.toLowerCase() === params.email.toLowerCase() &&
      inv.status === 'PENDING' &&
      new Date(inv.expiresAt) > new Date(),
  );
  if (existing) return existing;

  const id = crypto.randomUUID();
  const token = generateToken(id, params.orgId);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const invitation: OrgInvitation = {
    id,
    orgId: params.orgId,
    email: params.email.toLowerCase().trim(),
    role: params.role,
    token,
    expiresAt,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    createdBy: params.actingUserId,
  };

  invitations.set(id, invitation);

  await appendDomainAudit({
    entityType: 'ORG_INVITATION',
    entityId: id,
    action: 'INVITATION_CREATED',
    userId: params.actingUserId,
    payload: { orgId: params.orgId, email: params.email, role: params.role, expiresAt },
  });

  logger.info('org-invitation: created', { id, orgId: params.orgId, email: params.email });
  return invitation;
}

/**
 * Lista aktiva (PENDING, ej utgångna) inbjudningar för en organisation.
 */
export function listInvitations(orgId: string): OrgInvitation[] {
  const now = new Date();
  return Array.from(invitations.values())
    .filter((inv) => inv.orgId === orgId)
    .map((inv) => {
      if (inv.status === 'PENDING' && new Date(inv.expiresAt) <= now) {
        inv.status = 'EXPIRED';
        invitations.set(inv.id, inv);
      }
      return inv;
    });
}

/**
 * Acceptera en inbjudan via token.
 * Skapar användaren i organisationen om den inte redan finns.
 */
export async function acceptInvitation(params: {
  orgId: string;
  token: string;
  bankidId: string;
}): Promise<{ userId: string; orgId: string; role: string }> {
  const invite = Array.from(invitations.values()).find(
    (inv) => inv.orgId === params.orgId && inv.token === params.token,
  );

  if (!invite) throw new Error('Inbjudningstoken hittades inte');
  if (invite.status !== 'PENDING') throw new Error(`Inbjudan har status ${invite.status}`);
  if (new Date(invite.expiresAt) <= new Date()) {
    invite.status = 'EXPIRED';
    invitations.set(invite.id, invite);
    throw new Error('Inbjudan har löpt ut');
  }

  // Token integrity check
  if (!verifyToken(params.token, invite.id, invite.orgId)) {
    throw new Error('Ogiltig inbjudningstoken');
  }

  // Find or create user
  let user = await prisma.user.findFirst({
    where: { bankidId: params.bankidId, organisationId: invite.orgId },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        bankidId: params.bankidId,
        organisationId: invite.orgId,
        role: invite.role === 'ADMIN' ? 'ADMIN' : 'CONSULTANT',
      },
    });
  }

  invite.status = 'ACCEPTED';
  invitations.set(invite.id, invite);

  await appendDomainAudit({
    entityType: 'ORG_INVITATION',
    entityId: invite.id,
    action: 'INVITATION_ACCEPTED',
    userId: user.id,
    payload: { orgId: invite.orgId, bankidId: params.bankidId, role: invite.role },
  });

  logger.info('org-invitation: accepted', { id: invite.id, userId: user.id });
  return { userId: user.id, orgId: invite.orgId, role: invite.role };
}

/**
 * Återkalla en inbjudan (ADMIN-åtgärd).
 */
export async function revokeInvitation(params: {
  orgId: string;
  inviteId: string;
  actingUserId: string;
}): Promise<void> {
  const invite = invitations.get(params.inviteId);
  if (!invite || invite.orgId !== params.orgId) {
    throw new Error('Inbjudan hittades inte');
  }

  invite.status = 'REVOKED';
  invitations.set(invite.id, invite);

  await appendDomainAudit({
    entityType: 'ORG_INVITATION',
    entityId: params.inviteId,
    action: 'INVITATION_REVOKED',
    userId: params.actingUserId,
    payload: { orgId: params.orgId },
  });
}
