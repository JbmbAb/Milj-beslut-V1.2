import { prisma } from '../../../db/prisma';

export interface InteractionPrototypeSessionData {
  userId: string;
  organisationId: string;
  projectId?: string;
  lastInteractionId?: string;
  model?: string;
}

export async function findInteractionSessionForUser(args: { sessionId: string; userId: string; organisationId: string }) {
  return prisma.interactionPrototypeSession.findFirst({
    where: {
      id: args.sessionId,
      userId: args.userId,
      organisationId: args.organisationId,
    },
  });
}

export async function createInteractionSession(data: InteractionPrototypeSessionData) {
  return prisma.interactionPrototypeSession.create({
    data: {
      userId: data.userId,
      organisationId: data.organisationId,
      projectId: data.projectId,
      lastInteractionId: data.lastInteractionId,
      model: data.model || 'gemini-3.5-flash',
    },
  });
}

export async function updateInteractionSessionLastId(args: { sessionId: string; lastInteractionId: string }) {
  return prisma.interactionPrototypeSession.update({
    where: { id: args.sessionId },
    data: {
      lastInteractionId: args.lastInteractionId,
    },
  });
}
