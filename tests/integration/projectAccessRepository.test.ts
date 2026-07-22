import { prisma } from '../../server/db/prisma';
import { it, expect, beforeAll, afterAll } from 'vitest';

import { assertProjectMembership } from '../../server/repositories/projectAccessRepository';
import { describeIfDatabaseIntegration } from './integrationTestEnv';



describeIfDatabaseIntegration('projectAccessRepository Integration', () => {
  let org1Id: string;
  let user1Id: string;
  let project1Id: string; // Active project, user1 is member

  let org2Id: string;
  let user2Id: string; // Member of org2, not org1
  let project2Id: string; // Active project in org2

  let inactiveProjectId: string; // Inactive project in org1
  let noMembershipProjectId: string; // Active project in org1, user1 not member

  beforeAll(async () => {
    await prisma.$connect();

    // Setup Org 1, User 1, Project 1 (active, user1 is owner)
    const org1 = await prisma.organisation.create({
      data: { name: 'Org 1', orgNumber: `org1-${Date.now()}`, role: 'CLIENT' },
    });
    org1Id = org1.id;
    const user1 = await prisma.user.create({
      data: { bankidId: `user1-${Date.now()}`, organisationId: org1Id, role: 'ADMIN' },
    });
    user1Id = user1.id;
    const project1 = await prisma.project.create({
      data: { organisationId: org1Id, propertyDesignation: 'PROJECT1 1:1', status: 'ACTIVE' },
    });
    project1Id = project1.id;
    await prisma.projectMember.create({
      data: { projectId: project1Id, userId: user1Id, accessRole: 'OWNER' },
    });

    // Setup Org 2, User 2, Project 2 (active, user2 is owner)
    const org2 = await prisma.organisation.create({
      data: { name: 'Org 2', orgNumber: `org2-${Date.now()}`, role: 'CLIENT' },
    });
    org2Id = org2.id;
    const user2 = await prisma.user.create({
      data: { bankidId: `user2-${Date.now()}`, organisationId: org2Id, role: 'ADMIN' },
    });
    user2Id = user2.id;
    const project2 = await prisma.project.create({
      data: { organisationId: org2Id, propertyDesignation: 'PROJECT2 1:1', status: 'ACTIVE' },
    });
    project2Id = project2.id;
    await prisma.projectMember.create({
      data: { projectId: project2Id, userId: user2Id, accessRole: 'OWNER' },
    });

    // Setup Inactive Project (in org1, user1 is owner)
    const inactiveProject = await prisma.project.create({
      data: { organisationId: org1Id, propertyDesignation: 'INACTIVE 1:1', status: 'ARCHIVED' },
    });
    inactiveProjectId = inactiveProject.id;
    await prisma.projectMember.create({
      data: { projectId: inactiveProjectId, userId: user1Id, accessRole: 'OWNER' },
    });

    // Setup Project with no membership for user1 (in org1)
    const noMembershipProject = await prisma.project.create({
      data: { organisationId: org1Id, propertyDesignation: 'NO_MEMBER 1:1', status: 'ACTIVE' },
    });
    noMembershipProjectId = noMembershipProject.id;
    // No project member created for user1
  });

  afterAll(async () => {
    const projectIds = [project1Id, project2Id, inactiveProjectId, noMembershipProjectId].filter(Boolean);
    const userIds = [user1Id, user2Id].filter(Boolean);
    const organisationIds = [org1Id, org2Id].filter(Boolean);

    // Clean up in reverse order of creation to respect foreign key constraints
    await prisma.projectMember.deleteMany({
      where: {
        projectId: {
          in: projectIds,
        },
      },
    });
    await prisma.project.deleteMany({
      where: {
        id: {
          in: projectIds,
        },
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organisation.deleteMany({ where: { id: { in: organisationIds } } });
    await prisma.$disconnect();
  });

  it('should successfully assert membership for a valid user and project', async () => {
    await expect(
      assertProjectMembership({
        projectId: project1Id,
        userId: user1Id,
        organisationId: org1Id,
        role: 'ADMIN', // Role is currently not used in assertProjectMembership logic
      }),
    ).resolves.toBeUndefined();
  });

  it('should throw "Project not found" if projectId does not exist', async () => {
    const nonExistentProjectId = 'non-existent-project-id';
    await expect(
      assertProjectMembership({
        projectId: nonExistentProjectId,
        userId: user1Id,
        organisationId: org1Id,
      }),
    ).rejects.toThrow('Project not found');
  });

  it('should throw "Cross-organisation access denied" if organisationId does not match', async () => {
    await expect(
      assertProjectMembership({
        projectId: project1Id, // Project in Org 1
        userId: user2Id, // User in Org 2
        organisationId: org2Id, // User's Org 2
      }),
    ).rejects.toThrow('Cross-organisation access denied');
  });

  it('should throw "Project is not active" if project status is not ACTIVE', async () => {
    await expect(
      assertProjectMembership({
        projectId: inactiveProjectId,
        userId: user1Id,
        organisationId: org1Id,
      }),
    ).rejects.toThrow('Project is not active');
  });

  it('should throw "User is not a member of this project" if user is not a member', async () => {
    await expect(
      assertProjectMembership({
        projectId: noMembershipProjectId,
        userId: user1Id,
        organisationId: org1Id,
      }),
    ).rejects.toThrow('User is not a member of this project');
  });
});
