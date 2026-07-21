import { describe, it, expect, beforeEach } from 'vitest';
import { CreateProjectUseCase } from '../../src/application/create-project.usecase';
import { PrismaProjectRepository } from '../../src/infrastructure/prisma-project-repository';
import { PrismaAuditRepository } from '../../src/infrastructure/prisma-audit-repository';
import { ProjectType } from '../../src/domain/project';
import { prisma } from '../../db.server';

describe('V2 Architecture Integration: CreateProject', () => {
  const projectRepo = new PrismaProjectRepository();
  const auditRepo = new PrismaAuditRepository();
  const createProjectUseCase = new CreateProjectUseCase(projectRepo, auditRepo);

  // Vi använder en riktig organisation som finns i din DB eller skapar en temp
  const testOrgId = 'test-org-v2';

  beforeEach(async () => {
    // Rensning av testdata om nödvändigt
    // await prisma.project.deleteMany({ where: { organisationId: testOrgId } });
  });

  it('should create a project and log it in audit trail', async () => {
    const input = {
      name: 'Testprojekt V2',
      description: 'Verifiering av ny arkitektur',
      type: ProjectType.ENV_PERMIT,
      location: {
        lat: 59.3293,
        lng: 18.0686,
        address: 'Testgatan 1',
        propertyId: 'TEST-1-1',
        municipality: 'Stockholm',
      },
      organisationId: testOrgId,
      userId: 'test-user-123',
    };

    // 1. Kör Use Case
    const result = await createProjectUseCase.execute(input);

    // 2. Verifiera Returvärde
    expect(result.id).toBeDefined();
    expect(result.name).toBe(input.name);
    expect(result.status).toBe('DRAFT');

    // 3. Verifiera Persistens (Databas)
    const dbProject = await prisma.project.findUnique({
      where: { id: result.id },
    });
    expect(dbProject).toBeDefined();
    expect(dbProject?.propertyDesignation).toBe(input.location.propertyId);

    // 4. Verifiera Audit Trail (Detta är hjärtat i vår juridiska spårbarhet)
    const auditLogs = await auditRepo.findByEntity('Project', result.id);
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs[0].action).toBe('CREATE');
    expect(auditLogs[0].userId).toBe(input.userId);
  });
});
