import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../server/modules/ai/interactions/interactionsService', () => ({
  generateWithInteractions: vi.fn(),
}));

vi.mock('../../../server/modules/ai/interactions/interactionsSessionRepository', () => ({
  findInteractionSessionForUser: vi.fn(),
  createInteractionSession: vi.fn(),
  updateInteractionSessionLastId: vi.fn(),
}));

vi.mock('../../../server/security/auditTrail', () => ({
  appendDomainAudit: vi.fn(async () => ({ id: 'audit-1' })),
}));

vi.mock('../../../server/security/projectAccess', () => ({
  assertProjectAccess: vi.fn(async () => undefined),
}));

import { generateWithInteractions } from '../../../server/modules/ai/interactions/interactionsService';
import {
  createInteractionSession,
  findInteractionSessionForUser,
  updateInteractionSessionLastId,
} from '../../../server/modules/ai/interactions/interactionsSessionRepository';
import { runInteractionPrototypeTurn } from '../../../server/modules/ai/interactions/interactionsOrchestrator';
import { assertProjectAccess } from '../../../server/security/projectAccess';

const authUser = {
  id: 'user-1',
  organisationId: 'org-1',
  bankidId: 'bankid-1',
  role: 'ADMIN' as const,
};

describe('runInteractionPrototypeTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERACTIONS_PROTOTYPE_ENABLED = 'true';
    process.env.INTERACTIONS_GEMINI_API_KEY = 'test-key';
    process.env.INTERACTIONS_MODEL = 'gemini-3.5-flash';
  });

  afterEach(() => {
    delete process.env.INTERACTIONS_PROTOTYPE_ENABLED;
    delete process.env.INTERACTIONS_GEMINI_API_KEY;
    delete process.env.INTERACTIONS_MODEL;
  });

  it('returns 400 when prompt is empty', async () => {
    const result = await runInteractionPrototypeTurn({
      authUser,
      prompt: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it('creates a new session on first turn', async () => {
    vi.mocked(generateWithInteractions).mockResolvedValue({
      interactionId: 'int-1',
      outputText: 'Hello Environment Investigator',
      status: 'completed',
      stepCount: 2,
    });
    vi.mocked(createInteractionSession).mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      organisationId: 'org-1',
      projectId: null,
      lastInteractionId: 'int-1',
      model: 'gemini-3.5-flash',
      purpose: 'INTERACTIONS_PROTOTYPE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runInteractionPrototypeTurn({
      authUser,
      prompt: 'Hi, my name is Environment Investigator',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe('sess-1');
      expect(result.interactionId).toBe('int-1');
      expect(result.outputText).toContain('Environment Investigator');
    }
    expect(generateWithInteractions).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Hi, my name is Environment Investigator',
        previousInteractionId: undefined,
      }),
    );
  });

  it('continues an existing session with previous interaction id', async () => {
    vi.mocked(findInteractionSessionForUser).mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      organisationId: 'org-1',
      projectId: null,
      lastInteractionId: 'int-1',
      model: 'gemini-3.5-flash',
      purpose: 'INTERACTIONS_PROTOTYPE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(generateWithInteractions).mockResolvedValue({
      interactionId: 'int-2',
      outputText: 'Environment Investigator',
      status: 'completed',
      stepCount: 1,
    });
    vi.mocked(updateInteractionSessionLastId).mockResolvedValue({
      id: 'sess-1',
      userId: 'user-1',
      organisationId: 'org-1',
      projectId: null,
      lastInteractionId: 'int-2',
      model: 'gemini-3.5-flash',
      purpose: 'INTERACTIONS_PROTOTYPE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runInteractionPrototypeTurn({
      authUser,
      prompt: 'What is my name?',
      sessionId: 'sess-1',
    });

    expect(result.ok).toBe(true);
    expect(generateWithInteractions).toHaveBeenCalledWith(
      expect.objectContaining({
        previousInteractionId: 'int-1',
      }),
    );
    expect(updateInteractionSessionLastId).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      lastInteractionId: 'int-2',
    });
  });

  it('returns 404 when session is missing', async () => {
    vi.mocked(findInteractionSessionForUser).mockResolvedValue(null);

    const result = await runInteractionPrototypeTurn({
      authUser,
      prompt: 'What is my name?',
      sessionId: 'missing',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it('checks project access when projectId is provided', async () => {
    vi.mocked(generateWithInteractions).mockResolvedValue({
      interactionId: 'int-1',
      outputText: 'ok',
      status: 'completed',
      stepCount: 1,
    });
    vi.mocked(createInteractionSession).mockResolvedValue({
      id: 'sess-2',
      userId: 'user-1',
      organisationId: 'org-1',
      projectId: 'proj-1',
      lastInteractionId: 'int-1',
      model: 'gemini-3.5-flash',
      purpose: 'INTERACTIONS_PROTOTYPE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await runInteractionPrototypeTurn({
      authUser,
      prompt: 'hello',
      projectId: 'proj-1',
    });

    expect(assertProjectAccess).toHaveBeenCalledWith(authUser, 'proj-1', 'org-1');
  });
});
