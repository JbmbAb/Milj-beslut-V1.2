/**
 * PLATFORM MASTER (Composition Root)
 *
 * Den centrala kompositionsroten för miljöbeslutsplattformen.
 * Här slås den gamla PlatformMaster och den nya PlatformV2 samman för att
 * förena beroendehantering, instansiering och livscykel för samtliga controllers.
 */

import { PrismaProjectRepository } from '../infrastructure/prisma-project-repository';
import { PrismaAuditRepository } from '../infrastructure/prisma-audit-repository';
import { PrismaLogisticsRepository } from '../infrastructure/prisma-logistics-repository';
import { PrismaComplianceRepository } from '../infrastructure/prisma-compliance-repository';
import { PrismaGeoRepository } from '../infrastructure/prisma-geo-repository';
import { PrismaUserRepository } from '../infrastructure/prisma-user-repository';
import { PrismaDocumentRepository } from '../infrastructure/prisma-document-repository';
import { PrismaRequirementRepository } from '../infrastructure/prisma-requirement-repository';
import { PrismaPermitCaseRepository } from '../infrastructure/prisma-permit-case-repository';

import { ExternalMarketIntelAdapter } from '../infrastructure/external-market-adapter';
import { LantmaterietAdapter } from '../infrastructure/lantmateriet-adapter';
import { BankIdAdapter } from '../infrastructure/bankid-adapter';
import { GeminiAIAdapter } from '../infrastructure/gemini-ai-adapter';

import { ProjectController } from '../api/project.controller';
import { LogisticsController } from '../api/logistics.api';
import { ComplianceController } from '../api/compliance.api';
import { GeoController } from '../api/geo.api';
import { AuthController } from '../api/auth.api';
import { DocumentController } from '../api/document.api';
import { RequirementController } from '../api/requirement.api';
import { PermitController } from '../api/permit.api';

import { HealthService } from './health.service';

export class Platform {
  // Gemensamma controllers för båda plattformarna
  public project: ProjectController;
  public projects: ProjectController; // Alias för PlatformV2
  public logistics: LogisticsController;
  public compliance: ComplianceController;
  public permit: PermitController;
  public permits: PermitController; // Alias för PlatformV2
  public geo: GeoController;
  public auth: AuthController;
  
  // Specifika för PlatformV2
  public documents: DocumentController;
  public requirements: RequirementController;
  public audit: PrismaAuditRepository;
  public health: HealthService;

  constructor() {
    // ─── Repositories ─────────────────────────────────────────────────────────────
    const projectRepo = new PrismaProjectRepository();
    const auditRepo = new PrismaAuditRepository();
    const logisticsRepo = new PrismaLogisticsRepository();
    const complianceRepo = new PrismaComplianceRepository();
    const requirementRepo = new PrismaRequirementRepository();
    const permitRepo = new PrismaPermitCaseRepository();
    const geoRepo = new PrismaGeoRepository();
    const userRepo = new PrismaUserRepository();
    const documentRepo = new PrismaDocumentRepository();

    // ─── Adapters ─────────────────────────────────────────────────────────────────
    const marketIntelProvider = new ExternalMarketIntelAdapter();
    const geoProvider = new LantmaterietAdapter();
    const bankIdProvider = new BankIdAdapter();
    const aiAdapter = new GeminiAIAdapter();

    // ─── Controller Instansiering ─────────────────────────────────────────────────
    const projectCtrl = new ProjectController(projectRepo, auditRepo);
    this.project = projectCtrl;
    this.projects = projectCtrl;

    this.logistics = new LogisticsController(logisticsRepo, auditRepo, marketIntelProvider);
    this.compliance = new ComplianceController(complianceRepo, projectRepo, requirementRepo, auditRepo);
    
    const permitCtrl = new PermitController(permitRepo, auditRepo);
    this.permit = permitCtrl;
    this.permits = permitCtrl;

    this.geo = new GeoController(geoProvider, geoRepo, auditRepo);
    this.auth = new AuthController(bankIdProvider, userRepo);
    
    this.documents = new DocumentController(documentRepo, auditRepo);
    this.requirements = new RequirementController(requirementRepo, auditRepo);
    
    this.audit = auditRepo;
    this.health = new HealthService(projectRepo, aiAdapter);
  }
}

// Skapa en central, global instans av den sammanslagna plattformen
export const platform = new Platform();
export const platformV2 = platform;

// Exportera gamla klassnamn för fullständig bakåtkompatibilitet i befintliga tester och moduler
export class PlatformMaster extends Platform {}
export class PlatformV2 extends Platform {}
