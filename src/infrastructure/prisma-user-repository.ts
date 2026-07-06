import { prisma } from '../../db.server';
import { IUserRepository } from '../domain/user-repository.interface';
import { AuthUser } from '../domain/auth';

export class PrismaUserRepository implements IUserRepository {
  async findByBankId(bankidId: string): Promise<AuthUser | null> {
    const user = await prisma.user.findUnique({
      where: { bankidId },
      select: {
        id: true,
        role: true,
        organisationId: true,
        bankidId: true,
      },
    });

    if (!user || !user.organisationId) return null;

    return {
      id: user.id,
      role: user.role,
      organisationId: user.organisationId,
      bankidId: user.bankidId ?? undefined,
    };
  }

  async ensureMockUser(bankidId: string): Promise<AuthUser> {
    // Implement mock user creation for dev environments
    const org = await prisma.organisation.findFirst();
    let orgId = org?.id;

    if (!orgId) {
      const newOrg = await prisma.organisation.create({
        data: { name: 'Mock Organisation', orgNumber: '556000-0000', role: 'CLIENT' },
      });
      orgId = newOrg.id;
    }

    const user = await prisma.user.upsert({
      where: { bankidId },
      update: {},
      create: {
        bankidId,
        role: 'ADMIN',
        organisationId: orgId,
      },
      select: {
        id: true,
        role: true,
        organisationId: true,
        bankidId: true,
      },
    });

    return {
      id: user.id,
      role: user.role,
      organisationId: user.organisationId!,
      bankidId: user.bankidId ?? undefined,
    };
  }
}
