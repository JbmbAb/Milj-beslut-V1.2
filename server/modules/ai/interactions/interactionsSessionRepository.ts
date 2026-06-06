import { prisma } from '../../../../db/prisma';

export interface InteractionPrototypeSessionData {
  userId: string;
  organisationId: string;
  projectId?: string;
  lastInteractionId?: string;
  model?: string;
}

export const interactionsSessionRepository = {
  async findById(id: string) {
    return prisma.interactionPrototypeSession.findUnique({
      where: { id },
    });
  },

  async create(data: InteractionPrototypeSessionData) {
    return prisma.interactionPrototypeSession.create({
      data: {
        userId: data.userId,
        organisationId: data.organisationId,
        projectId: data.projectId,
        lastInteractionId: data.lastInteractionId,
        model: data.model || 'gemini-3.5-flash',
      },
    });
  },

  async updateLastInteraction(id: string, interactionId: string) {
    return prisma.interactionPrototypeSession.update({
      where: { id },
      data: {
        lastInteractionId: interactionId,
      },
    });
  },

  async findByProjectAndUser(projectId: string, userId: string) {
    return prisma.interactionPrototypeSession.findFirst({
      where: {
        projectId,
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  },
};
