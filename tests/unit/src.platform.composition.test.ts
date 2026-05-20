import { afterEach, describe, expect, it, vi } from 'vitest';

function makeCtorMock(kind: string) {
  return vi.fn(function MockedCtor(this: Record<string, unknown>) {
    this.kind = kind;
  });
}

describe('src composition roots', { timeout: 15000 }, () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('wires the legacy platform master with expected repositories, adapters and controllers', async () => {
    const PrismaProjectRepository = makeCtorMock('projectRepo');
    const PrismaAuditRepository = makeCtorMock('auditRepo');
    const PrismaLogisticsRepository = makeCtorMock('logisticsRepo');
    const PrismaComplianceRepository = makeCtorMock('complianceRepo');
    const PrismaRequirementRepository = makeCtorMock('requirementRepo');
    const PrismaPermitCaseRepository = makeCtorMock('permitRepo');
    const PrismaGeoRepository = makeCtorMock('geoRepo');
    const PrismaUserRepository = makeCtorMock('userRepo');
    const ExternalMarketIntelAdapter = makeCtorMock('marketAdapter');
    const LantmaterietAdapter = makeCtorMock('geoAdapter');
    const BankIdAdapter = makeCtorMock('bankIdAdapter');

    const ProjectController = makeCtorMock('projectController');
    const LogisticsController = makeCtorMock('logisticsController');
    const ComplianceController = makeCtorMock('complianceController');
    const PermitController = makeCtorMock('permitController');
    const GeoController = makeCtorMock('geoController');
    const AuthController = makeCtorMock('authController');

    vi.doMock('../../src/infrastructure/prisma-project-repository', () => ({
      PrismaProjectRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-audit-repository', () => ({
      PrismaAuditRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-logistics-repository', () => ({
      PrismaLogisticsRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-compliance-repository', () => ({
      PrismaComplianceRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-requirement-repository', () => ({
      PrismaRequirementRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-permit-case-repository', () => ({
      PrismaPermitCaseRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-geo-repository', () => ({
      PrismaGeoRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-user-repository', () => ({
      PrismaUserRepository,
    }));
    vi.doMock('../../src/infrastructure/external-market-adapter', () => ({
      ExternalMarketIntelAdapter,
    }));
    vi.doMock('../../src/infrastructure/lantmateriet-adapter', () => ({
      LantmaterietAdapter,
    }));
    vi.doMock('../../src/infrastructure/bankid-adapter', () => ({
      BankIdAdapter,
    }));
    vi.doMock('../../src/api/project.controller', () => ({ ProjectController }));
    vi.doMock('../../src/api/logistics.api', () => ({ LogisticsController }));
    vi.doMock('../../src/api/compliance.api', () => ({ ComplianceController }));
    vi.doMock('../../src/api/permit.api', () => ({ PermitController }));
    vi.doMock('../../src/api/geo.api', () => ({ GeoController }));
    vi.doMock('../../src/api/auth.api', () => ({ AuthController }));

    const { platform } = await import('../../src/platform/master');

    expect(PrismaProjectRepository).toHaveBeenCalledOnce();
    expect(PrismaAuditRepository).toHaveBeenCalledOnce();
    expect(LogisticsController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'logisticsRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
      expect.objectContaining({ kind: 'marketAdapter' }),
    );
    expect(ComplianceController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'complianceRepo' }),
      expect.objectContaining({ kind: 'projectRepo' }),
      expect.objectContaining({ kind: 'requirementRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
    );
    expect(PermitController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'permitRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
    );
    expect(GeoController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'geoAdapter' }),
      expect.objectContaining({ kind: 'geoRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
    );
    expect(AuthController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bankIdAdapter' }),
      expect.objectContaining({ kind: 'userRepo' }),
    );
    expect(platform.project).toBeInstanceOf(ProjectController as any);
  });

  it('wires PlatformV2 with repositories, controllers and health service', async () => {
    const PrismaProjectRepository = makeCtorMock('projectRepo');
    const PrismaAuditRepository = makeCtorMock('auditRepo');
    const PrismaDocumentRepository = makeCtorMock('documentRepo');
    const PrismaRequirementRepository = makeCtorMock('requirementRepo');
    const PrismaPermitCaseRepository = makeCtorMock('permitRepo');
    const GeminiAIAdapter = vi.fn(function MockedGemini(this: Record<string, unknown>) {
      this.kind = 'aiAdapter';
    });
    const ProjectController = makeCtorMock('projectController');
    const DocumentController = makeCtorMock('documentController');
    const RequirementController = makeCtorMock('requirementController');
    const PermitController = makeCtorMock('permitController');
    const HealthService = makeCtorMock('healthService');

    vi.doMock('../../src/infrastructure/prisma-project-repository', () => ({
      PrismaProjectRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-audit-repository', () => ({
      PrismaAuditRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-document-repository', () => ({
      PrismaDocumentRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-requirement-repository', () => ({
      PrismaRequirementRepository,
    }));
    vi.doMock('../../src/infrastructure/prisma-permit-case-repository', () => ({
      PrismaPermitCaseRepository,
    }));
    vi.doMock('../../src/infrastructure/gemini-ai-adapter', () => ({
      GeminiAIAdapter,
    }));
    vi.doMock('../../src/api/project.controller', () => ({ ProjectController }));
    vi.doMock('../../src/api/document.api', () => ({ DocumentController }));
    vi.doMock('../../src/api/requirement.api', () => ({ RequirementController }));
    vi.doMock('../../src/api/permit.api', () => ({ PermitController }));
    vi.doMock('../../src/platform/health.service', () => ({ HealthService }));

    const { PlatformV2, platformV2 } = await import('../../src/api/platform.master');
    const instance = new PlatformV2();

    expect(DocumentController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'documentRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
    );
    expect(RequirementController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'requirementRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
    );
    expect(PermitController).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'permitRepo' }),
      expect.objectContaining({ kind: 'auditRepo' }),
    );
    expect(HealthService).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'projectRepo' }),
      expect.objectContaining({ kind: 'aiAdapter' }),
    );
    expect(instance.projects).toBeInstanceOf(ProjectController as any);
    expect(platformV2.documents).toBeInstanceOf(DocumentController as any);
  });
});
