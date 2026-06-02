import { appendDomainAudit } from '../../../security/auditTrail';
import { assertProjectAccess } from '../../../security/projectAccess';
import type { AuthUser } from '../../../security/types';
import {
  assertInteractionsPrototypeConfigured,
  interactionsPrototypeSystemInstruction,
} from './interactionsConfig';
import {
  createInteractionSession,
  findInteractionSessionForUser,
  updateInteractionSessionLastId,
} from './interactionsSessionRepository';
import { generateWithInteractions } from './interactionsService';
import type { InteractionPrototypeTurnResult } from './types';

const MAX_PROMPT_LENGTH = 8_000;

export function interactionPrototypeAuditRef(sessionId: string): string {
  return `INT-PROT-${sessionId}`;
}

export async function runInteractionPrototypeTurn(input: {
  authUser: AuthUser;
  prompt: string;
  sessionId?: string;
  projectId?: string;
}): Promise<InteractionPrototypeTurnResult> {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) {
    return { ok: false, status: 400, error: 'prompt is required' };
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return { ok: false, status: 400, error: `prompt must be at most ${MAX_PROMPT_LENGTH} characters` };
  }

  const projectId = String(input.projectId || '').trim() || undefined;
  if (projectId) {
    await assertProjectAccess(input.authUser, projectId, input.authUser.organisationId);
  }

  const config = assertInteractionsPrototypeConfigured();
  const sessionId = String(input.sessionId || '').trim() || undefined;

  let previousInteractionId: string | undefined;
  let existingSessionId: string | undefined;

  if (sessionId) {
    const existing = await findInteractionSessionForUser({
      sessionId,
      userId: input.authUser.id,
      organisationId: input.authUser.organisationId,
    });
    if (!existing) {
      return { ok: false, status: 404, error: 'Session not found' };
    }
    if (projectId && existing.projectId && existing.projectId !== projectId) {
      return { ok: false, status: 403, error: 'Session project mismatch' };
    }
    previousInteractionId = existing.lastInteractionId ?? undefined;
    existingSessionId = existing.id;
  }

  const aiResult = await generateWithInteractions({
    prompt,
    previousInteractionId,
    model: config.model,
    store: config.store,
    systemInstruction: interactionsPrototypeSystemInstruction(),
  });

  const session = existingSessionId
    ? await updateInteractionSessionLastId({
        sessionId: existingSessionId,
        lastInteractionId: aiResult.interactionId,
      })
    : await createInteractionSession({
        userId: input.authUser.id,
        organisationId: input.authUser.organisationId,
        projectId,
        lastInteractionId: aiResult.interactionId,
        model: config.model,
      });

  await appendDomainAudit({
    entityType: 'InteractionPrototype',
    entityId: interactionPrototypeAuditRef(session.id),
    action: existingSessionId ? 'UPDATE' : 'CREATE',
    userId: input.authUser.id,
    payload: {
      sessionId: session.id,
      interactionId: aiResult.interactionId,
      model: config.model,
      promptLength: prompt.length,
      stepCount: aiResult.stepCount,
      status: aiResult.status,
      projectId: projectId ?? session.projectId ?? null,
    },
  });

  return {
    ok: true,
    sessionId: session.id,
    interactionId: aiResult.interactionId,
    outputText: aiResult.outputText,
    status: aiResult.status,
    meta: {
      model: config.model,
      stepCount: aiResult.stepCount,
      usage: aiResult.usage,
    },
  };
}
