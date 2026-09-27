/**
 * DEMO-01 routes. Mounted by createApp only when DEMO_C_ANMALAN_ENABLED=true (server-owned flag;
 * client config is not a security boundary). No submit route exists (K-26 §6).
 */
import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../security/auth';
import { rateLimitByUser } from '../../security/rateLimit';
import { toSafeErrorResponse } from '../../security/secureErrors';
import { releaseSha } from './approvalGate';
import { approveCase, caseAuditTrail, casePdf, createCase, getCase, proposeCase, updateInput } from './demoService';
import { loadRequirements } from './requirementsSource';
import type { DemoCaseInput, RowDecision } from './types';

export function isDemoCAnmalanEnabled(): boolean {
  return String(process.env.DEMO_C_ANMALAN_ENABLED || '').trim().toLowerCase() === 'true';
}

const BASE = '/api/demo/c-anmalan';
const text = z.string().max(4000).default('');

export const caseInputSchema = z.object({
  propertyDesignation: z.string().trim().min(3).max(120),
  verksamhetskoder: z.array(z.string().trim().regex(/^\d{2}\.\d{2,3}(-i)?$/)).min(1).max(6),
  avfallstyper: text,
  mangdPerArTon: text,
  maxSamtidigtLagradTon: text,
  verksamhetsutovare: text,
  ytansKonstruktion: text,
  jordart: text,
  lutningAvrinning: text,
  dagvatten: text,
  verksamhetsbeskrivning: text,
  anvandarensForsiktighetsmatt: text,
  anvandarensEgenkontroll: text,
  placeholder: z.boolean(),
});

const decisionSchema = z.discriminatedUnion('action', [
  z.object({ rowId: z.string().min(1), action: z.literal('accept') }),
  z.object({ rowId: z.string().min(1), action: z.literal('strike') }),
  z.object({ rowId: z.string().min(1), action: z.literal('edit'), text: z.string().trim().min(1).max(4000) }),
]);

const router = express.Router();

type Handler = (req: express.Request, res: express.Response) => Promise<void>;
const guarded = (fn: Handler): express.RequestHandler => async (req, res) => {
  try {
    if (!req.authUser) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    await fn(req, res);
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
};

function send<T>(res: express.Response, result: { ok: true; value: T } | { ok: false; status: number; error: string }) {
  if (result.ok === false) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, case: result.value });
}

router.get(`${BASE}/status`, requireAuth, guarded(async (_req, res) => {
  res.json({ ok: true, enabled: true, releaseSha: releaseSha(), requirements: loadRequirements().status, submit: false });
}));

router.post(`${BASE}/cases`, requireAuth, rateLimitByUser(20, 60_000), guarded(async (req, res) => {
  const body = z.object({ projectId: z.string().min(1), input: caseInputSchema }).parse(req.body);
  const result = await createCase(req.authUser!, body.projectId, body.input as DemoCaseInput);
  if (result.ok) res.status(201);
  send(res, result);
}));

router.get(`${BASE}/cases/:id`, requireAuth, guarded(async (req, res) => {
  send(res, getCase(req.authUser!, String(req.params.id)));
}));

router.put(`${BASE}/cases/:id/input`, requireAuth, rateLimitByUser(30, 60_000), guarded(async (req, res) => {
  const body = z.object({ input: caseInputSchema, reopen: z.boolean().optional() }).parse(req.body);
  send(res, await updateInput(req.authUser!, String(req.params.id), body.input as DemoCaseInput, body.reopen === true));
}));

router.post(`${BASE}/cases/:id/proposal`, requireAuth, rateLimitByUser(20, 60_000), guarded(async (req, res) => {
  const body = z.object({ reopen: z.boolean().optional() }).parse(req.body ?? {});
  send(res, await proposeCase(req.authUser!, String(req.params.id), body.reopen === true));
}));

router.post(`${BASE}/cases/:id/approve`, requireAuth, rateLimitByUser(20, 60_000), guarded(async (req, res) => {
  const body = z.object({ decisions: z.array(decisionSchema).min(1) }).parse(req.body);
  send(res, await approveCase(req.authUser!, String(req.params.id), body.decisions as RowDecision[]));
}));

router.get(`${BASE}/cases/:id/pdf/:kind`, requireAuth, rateLimitByUser(20, 60_000), guarded(async (req, res) => {
  const kind = z.enum(['anmalan', 'egenkontroll']).parse(req.params.kind);
  const result = await casePdf(req.authUser!, String(req.params.id), kind);
  if (result.ok === false) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${result.value.filename}"`);
  res.send(result.value.buffer);
}));

router.get(`${BASE}/cases/:id/audit-trail`, requireAuth, guarded(async (req, res) => {
  const result = await caseAuditTrail(req.authUser!, String(req.params.id));
  if (result.ok === false) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, entries: result.value });
}));

export default router;
