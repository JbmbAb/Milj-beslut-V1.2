import type { InteractionPrototypeSession } from '@prisma/client';
import { prisma } from '../../../db/prisma';

export async function findInteractionSessionForUser(input: {
  sessionId: string;
  userId: string;
  organisationId: string;
}): Promise<InteractionPrototypeSession | null> {
  return prisma.interactionPrototypeSession.findFirst({
    where: {
      id: input.sessionId,
      userId: input.userId,
      organisationId: input.organisationId,
    },
  });
}

export async function createInteractionSession(input: {
  userId: string;
  organisationId: string;
  projectId?: string | null;
  lastInteractionId: string;
  model: string;
}): Promise<InteractionPrototypeSession> {
  return prisma.interactionPrototypeSession.create({
    data: {
      userId: input.userId,
      organisationId: input.organisationId,
      projectId: input.projectId ?? null,
      lastInteractionId: input.lastInteractionId,
      model: input.model,
      purpose: 'INTERACTIONS_PROTOTYPE',
    },
  });
}

export async function updateInteractionSessionLastId(input: {
  sessionId: string;
  lastInteractionId: string;
}): Promise<InteractionPrototypeSession> {
  return prisma.interactionPrototypeSession.update({
    where: { id: input.sessionId },
    data: { lastInteractionId: input.lastInteractionId },
  });
}
