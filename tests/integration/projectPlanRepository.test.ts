import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  getStoredProjectPlan,
  upsertStoredProjectPlan,
} from '../../server/repositories/projectPlanRepository';
import { ProjectPlan } from '../../types';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

const prisma = new PrismaClient();

describeIfDatabaseIntegration('projectPlanRepository Integration', () => {
  let testOrgId: string;
  let testUserId: string;
  let testProjectId: string;

  let otherOrgId: string;
  let otherUserId: string;
  let otherProjectId: string;

  const basePlan: ProjectPlan = {
    name: 'Test Plan',
    revision: '1.0',
    projectType: 'ENV_PERMIT',
    templateId: 'DEFAULT',
    background: 'Test background',
    description: 'Test description',
    goals: [],
    location: { lat: 0, lng: 0, address: 'Testvägen 1', propertyId: 'TEST 1:1' },
    stakeholders: [],
    phases: [],
    complianceScore: 0,
    auditTrail: [],
    branding: { organizationName: 'Test Org', logoUrl: '', layoutTemplate: 'CORPORATE', primaryColor: '' },
    moduleIntegrations: [],
    documentArchive: [],
    samplingPreparation: {
      enabled: false,
      requiresPreparationNow: false,
      protocolTemplate: '',
      chainOfCustodyTemplate: '',
      plannedServiceWindow: '',
      checklist: [],
    },
    stageGates: [],
    mapLayerSelection: { base: [], optional: [], enabled: [], unavailable: [] },
    permitCodeProfile: null,
    storageAreas: [],
    dispatchQuotes: [],
    transportBookings: [],
    driverJournals: [],
    limsReports: [],
    carbonSummary: { lastInput: null, lastResult: null, history: [] },
  };

  beforeAll(async () => {
    await prisma.$connect();

    // Setup for main test user/org/project
    const org = await prisma.organisation.create({
      data: { name: 'Test Org', orgNumber: `test-org-${Date.now()}` },
    });
    testOrgId = org.id;
    const user = await prisma.user.create({
      data: { bankidId: `test-user-${Date.now()}`, organisationId: testOrgId, role: 'ADMIN' },
    });
    testUserId = user.id;
    const project = await prisma.project.create({
      data: { organisationId: testOrgId, propertyDesignation: 'TEST 1:1', status: 'ACTIVE' },
    });
    testProjectId = project.id;
    await prisma.projectMember.create({
      data: { projectId: testProjectId, userId: testUserId, accessRole: 'OWNER' },
    });

    // Setup for other org/user/project (for access control tests)
    const otherOrg = await prisma.organisation.create({
      data: { name: 'Other Org', orgNumber: `other-org-${Date.now()}` },
    });
    otherOrgId = otherOrg.id;
    const otherUser = await prisma.user.create({
      data: { bankidId: `other-user-${Date.now()}`, organisationId: otherOrgId, role: 'ADMIN' },
    });
    otherUserId = otherUser.id;
    const otherProject = await prisma.project.create({
      data: { organisationId: otherOrgId, propertyDesignation: 'OTHER 1:1', status: 'ACTIVE' },
    });
    otherProjectId = otherProject.id;
    await prisma.projectMember.create({
      data: { projectId: otherProjectId, userId: otherUserId, accessRole: 'OWNER' },
    });
  });

  afterAll(async () => {
    const projectIds = [testProjectId, otherProjectId].filter(Boolean);
    const userIds = [testUserId, otherUserId].filter(Boolean);
    const organisationIds = [testOrgId, otherOrgId].filter(Boolean);

    // Clean up all test data
    await prisma.projectPlanState.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    await prisma.projectMember.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: organisationIds } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const projectIds = [testProjectId, otherProjectId].filter(Boolean);

    // Clear project plan states before each test to ensure isolation
    await prisma.projectPlanState.deleteMany({
      where: { projectId: { in: projectIds } },
    });
  });

  describe('upsertStoredProjectPlan', () => {
    it('should create a new project plan state', async () => {
      const plan = { ...basePlan, name: 'Initial Plan' };
      const createdPlanState = await upsertStoredProjectPlan({
        projectId: testProjectId,
        organisationId: testOrgId,
        schemaVersion: 1,
        plan,
      });

      expect(createdPlanState).toBeDefined();
      expect(createdPlanState.projectId).toBe(testProjectId);
      expect(createdPlanState.schemaVersion).toBe(1);
      expect(createdPlanState.plan).toEqual(plan);

      const retrievedPlan = await getStoredProjectPlan(testProjectId, testOrgId);
      expect(retrievedPlan).toEqual(plan);
    });

    it('should update an existing project plan state', async () => {
      const initialPlan = { ...basePlan, name: 'Initial Plan' };
      await upsertStoredProjectPlan({
        projectId: testProjectId,
        organisationId: testOrgId,
        schemaVersion: 1,
        plan: initialPlan,
      });

      const updatedPlan = { ...basePlan, name: 'Updated Plan', revision: '1.1' };
      const updatedPlanState = await upsertStoredProjectPlan({
        projectId: testProjectId,
        organisationId: testOrgId,
        schemaVersion: 2,
        plan: updatedPlan,
      });

      expect(updatedPlanState).toBeDefined();
      expect(updatedPlanState.projectId).toBe(testProjectId);
      expect(updatedPlanState.schemaVersion).toBe(2);
      expect(updatedPlanState.plan).toEqual(updatedPlan);

      const retrievedPlan = await getStoredProjectPlan(testProjectId, testOrgId);
      expect(retrievedPlan).toEqual(updatedPlan);
    });

    it('should throw an error if project does not exist', async () => {
      const nonExistentProjectId = 'non-existent-project';
      const plan = { ...basePlan, name: 'Plan for non-existent' };

      await expect(
        upsertStoredProjectPlan({
          projectId: nonExistentProjectId,
          organisationId: testOrgId,
          schemaVersion: 1,
          plan,
        }),
      ).rejects.toThrow('Project not found or access denied');
    });

    it('should throw an error if organisationId does not match the project', async () => {
      const plan = { ...basePlan, name: 'Cross-org Plan' };

      await expect(
        upsertStoredProjectPlan({
          projectId: otherProjectId, // Try to update other project
          organisationId: testOrgId, // With current user's org
          schemaVersion: 1,
          plan,
        }),
      ).rejects.toThrow('Project not found or access denied');
    });
  });

  describe('getStoredProjectPlan', () => {
    it('should retrieve an existing project plan', async () => {
      const plan = { ...basePlan, name: 'Retrievable Plan' };
      await upsertStoredProjectPlan({
        projectId: testProjectId,
        organisationId: testOrgId,
        schemaVersion: 1,
        plan,
      });

      const retrievedPlan = await getStoredProjectPlan(testProjectId, testOrgId);
      expect(retrievedPlan).toEqual(plan);
    });

    it('should return null if no project plan exists', async () => {
      const retrievedPlan = await getStoredProjectPlan(testProjectId, testOrgId);
      expect(retrievedPlan).toBeNull();
    });

    it('should return null if project does not exist', async () => {
      const nonExistentProjectId = 'non-existent-project-for-get';
      const retrievedPlan = await getStoredProjectPlan(nonExistentProjectId, testOrgId);
      expect(retrievedPlan).toBeNull();
    });

    it('should return null if organisationId does not match the project', async () => {
      const plan = { ...basePlan, name: 'Other Org Plan' };
      await upsertStoredProjectPlan({
        projectId: otherProjectId,
        organisationId: otherOrgId,
        schemaVersion: 1,
        plan,
      });

      const retrievedPlan = await getStoredProjectPlan(otherProjectId, testOrgId); // Try to get other project's plan with current user's org
      expect(retrievedPlan).toBeNull(); // Should not be found due to orgId mismatch
    });
  });
});
