import { PrismaProjectRepository } from '../infrastructure/prisma-project-repository';
import { PrismaAuditRepository } from '../infrastructure/prisma-audit-repository';
import { PrismaDocumentRepository } from '../infrastructure/prisma-document-repository';
import { PrismaRequirementRepository } from '../infrastructure/prisma-requirement-repository';
import { PrismaPermitCaseRepository } from '../infrastructure/prisma-permit-case-repository';
import { GeminiAIAdapter } from '../infrastructure/gemini-ai-adapter';

import { ProjectController } from './project.controller';
import { DocumentController } from './document.api';
import { RequirementController } from './requirement.api';
import { PermitController } from './permit.api';
import { HealthService } from '../platform/health.service';

/**
 * PlatformV2 - Centraliserad åtkomstpunkt för den nya arkitekturen.
 * Detta gör det enkelt att byta ut implementationer utan att ändra i UI-lagret.
 */
export class PlatformV2 {
  public projects: ProjectController;
  public documents: DocumentController;
  public requirements: RequirementController;
  public permits: PermitController;
  public audit: PrismaAuditRepository;
  public health: HealthService;

  constructor() {
    const auditRepo = new PrismaAuditRepository();
    const projectRepo = new PrismaProjectRepository();
    const documentRepo = new PrismaDocumentRepository();
    const requirementRepo = new PrismaRequirementRepository();
    const permitRepo = new PrismaPermitCaseRepository();
    const aiAdapter = new GeminiAIAdapter();

    this.projects = new ProjectController(projectRepo, auditRepo);
    this.documents = new DocumentController(documentRepo, auditRepo);
    this.requirements = new RequirementController(requirementRepo, auditRepo);
    this.permits = new PermitController(permitRepo, auditRepo);
    this.audit = auditRepo;
    this.health = new HealthService(projectRepo, aiAdapter);
  }
}

export const platformV2 = new PlatformV2();
