/**
 * PLATFORM MASTER (Composition Root)
 * Här orkestrerar vi alla beroenden och instansierar controllers.
 */
import { PrismaProjectRepository } from '../infrastructure/prisma-project-repository';
import { PrismaAuditRepository } from '../infrastructure/prisma-audit-repository';
import { PrismaLogisticsRepository } from '../infrastructure/prisma-logistics-repository';
import { PrismaComplianceRepository } from '../infrastructure/prisma-compliance-repository';
import { PrismaGeoRepository } from '../infrastructure/prisma-geo-repository';
import { PrismaUserRepository } from '../infrastructure/prisma-user-repository';
import { ExternalMarketIntelAdapter } from '../infrastructure/external-market-adapter';
import { LantmaterietAdapter } from '../infrastructure/lantmateriet-adapter';
import { BankIdAdapter } from '../infrastructure/bankid-adapter';

import { ProjectController } from '../api/project.controller';
import { LogisticsController } from '../api/logistics.api';
import { ComplianceController } from '../api/compliance.api';
import { GeoController } from '../api/geo.api';
import { AuthController } from '../api/auth.api';
import { PrismaRequirementRepository } from '../infrastructure/prisma-requirement-repository';
import { PrismaPermitCaseRepository } from '../infrastructure/prisma-permit-case-repository';
import { PermitController } from '../api/permit.api';

class PlatformMaster {
  public project: ProjectController;
  public logistics: LogisticsController;
  public compliance: ComplianceController;
  public permit: PermitController;
  public geo: GeoController;
  public auth: AuthController;

  constructor() {
    // Repositories
    const projectRepo = new PrismaProjectRepository();
    const auditRepo = new PrismaAuditRepository();
    const logisticsRepo = new PrismaLogisticsRepository();
    const complianceRepo = new PrismaComplianceRepository();
    const requirementRepo = new PrismaRequirementRepository();
    const permitRepo = new PrismaPermitCaseRepository();
    const geoRepo = new PrismaGeoRepository();
    const userRepo = new PrismaUserRepository();

    // Adapters
    const marketIntelProvider = new ExternalMarketIntelAdapter();
    const geoProvider = new LantmaterietAdapter();
    const bankIdProvider = new BankIdAdapter();

    // Controllers
    this.project = new ProjectController(projectRepo, auditRepo);
    this.logistics = new LogisticsController(logisticsRepo, auditRepo, marketIntelProvider);
    this.compliance = new ComplianceController(complianceRepo, projectRepo, requirementRepo, auditRepo);
    this.permit = new PermitController(permitRepo, auditRepo);
    this.geo = new GeoController(geoProvider, geoRepo, auditRepo);
    this.auth = new AuthController(bankIdProvider, userRepo);
  }
}

export const platform = new PlatformMaster();
