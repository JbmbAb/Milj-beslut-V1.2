import {
  PrismaClient,
  Organisation,
  User,
  Project,
  DocumentRecord,
  ProjectStatus,
  UserRole,
  DocumentProcessingStatus,
  OrganizationRole,
} from '@prisma/client';

/**
 * A factory for creating test data entities.
 * This centralizes test data creation to reduce duplication in test files.
 */
export class TestDataFactory {
  private prisma: PrismaClient;

  constructor(prismaInstance: PrismaClient) {
    this.prisma = prismaInstance;
  }

  async createOrganisation(overrides: Partial<Organisation> = {}): Promise<Organisation> {
    const orgNumber = overrides.orgNumber || `test-org-${Date.now()}`;
    return this.prisma.organisation.create({
      data: {
        name: 'Test Organisation',
        orgNumber,
        role: OrganizationRole.CLIENT,
        ...overrides,
      },
    });
  }

  async createUser(organisationId: string, overrides: Partial<User> = {}): Promise<User> {
    return this.prisma.user.create({
      data: {
        bankidId: `test-user-${Date.now()}`,
        role: UserRole.CONSULTANT,
        organisationId,
        ...overrides,
      },
    });
  }

  async createProject(organisationId: string, overrides: Partial<Project> = {}): Promise<Project> {
    return this.prisma.project.create({
      data: {
        propertyDesignation: `TEST-PROPERTY-${Date.now()}`,
        status: ProjectStatus.ACTIVE,
        organisationId,
        ...overrides,
      },
    });
  }

  async createDocument(
    projectId: string,
    organisationId: string,
    overrides: Partial<DocumentRecord> = {},
  ): Promise<DocumentRecord> {
    const now = Date.now();
    return this.prisma.documentRecord.create({
      data: {
        projectId,
        organisationId,
        originalName: `test-doc-${now}.pdf`,
        diskName: `disk-name-${now}`,
        absolutePath: `/test/path/${now}`,
        entryId: `entry-${now}`,
        subject: `Test Subject ${now}`,
        status: DocumentProcessingStatus.METADATA_ONLY,
        ...overrides,
      },
    });
  }

  async createRequirementCase(
    projectId: string,
    documentId: string,
    organisationId: string,
    overrides: any = {},
  ) {
    return this.prisma.requirementCase.create({
      data: {
        caseKey: `CASE-${Date.now()}`,
        projectId,
        documentId,
        organisationId,
        sourceFile: 'test.pdf',
        ...overrides,
      },
    });
  }

  async createRequirement(caseId: string, documentId: string, projectId: string, overrides: any = {}) {
    return this.prisma.requirementRecord.create({
      data: {
        requirementCode: `REQ-${Date.now()}-${Math.random()}`,
        caseId,
        documentId,
        projectId,
        sourceType: 'DECISION',
        category: 'WASTE',
        subcategory: 'STORAGE',
        requirementTextQuote: 'Quote',
        interpretedRequirement: 'Requirement',
        level: 'MANDATORY',
        ...overrides,
      },
    });
  }

  async seedPropertyUnit(designation: string, sourceKey: string) {
    const { seedPropertyUnit } = await import('../helpers/postgisSeed');
    await seedPropertyUnit(this.prisma, { designation, sourceKey });
  }

  async seedProtectedArea(nvrId: string, name: string, protectionType: string) {
    const { seedProtectedArea } = await import('../helpers/postgisSeed');
    await seedProtectedArea(this.prisma, { nvrId, name, protectionType });
  }

  async seedSguWell(lng: number, lat: number) {
    const { seedSguWell } = await import('../helpers/postgisSeed');
    await seedSguWell(this.prisma, lng, lat);
  }
}
