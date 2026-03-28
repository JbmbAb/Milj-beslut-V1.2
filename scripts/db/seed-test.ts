import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_ORG_NUMBER = '999999-0001';
const TEST_ORG_NAME = 'Miljobeslut Test Org';
const TEST_ADMIN_BANKID = 'admin:admin';
const TEST_CONSULTANT_BANKID = 'consultant:test';
const TEST_PROJECT_ID = 'test-project-001';

async function main() {
  const org = await prisma.organisation.upsert({
    where: { orgNumber: TEST_ORG_NUMBER },
    create: {
      name: TEST_ORG_NAME,
      orgNumber: TEST_ORG_NUMBER,
    },
    update: {
      name: TEST_ORG_NAME,
    },
  });

  const adminUser = await prisma.user.upsert({
    where: { bankidId: TEST_ADMIN_BANKID },
    create: {
      bankidId: TEST_ADMIN_BANKID,
      organisationId: org.id,
      role: 'ADMIN',
    },
    update: {
      organisationId: org.id,
      role: 'ADMIN',
    },
  });

  const consultantUser = await prisma.user.upsert({
    where: { bankidId: TEST_CONSULTANT_BANKID },
    create: {
      bankidId: TEST_CONSULTANT_BANKID,
      organisationId: org.id,
      role: 'CONSULTANT',
    },
    update: {
      organisationId: org.id,
      role: 'CONSULTANT',
    },
  });

  const project = await prisma.project.upsert({
    where: { id: TEST_PROJECT_ID },
    create: {
      id: TEST_PROJECT_ID,
      organisationId: org.id,
      propertyDesignation: 'TEST 1:1',
      status: 'ACTIVE',
    },
    update: {
      organisationId: org.id,
      propertyDesignation: 'TEST 1:1',
      status: 'ACTIVE',
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: adminUser.id,
      },
    },
    create: {
      projectId: project.id,
      userId: adminUser.id,
      accessRole: 'OWNER',
    },
    update: {
      accessRole: 'OWNER',
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_userId: {
        projectId: project.id,
        userId: consultantUser.id,
      },
    },
    create: {
      projectId: project.id,
      userId: consultantUser.id,
      accessRole: 'CONTRIBUTOR',
    },
    update: {
      accessRole: 'CONTRIBUTOR',
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        orgId: org.id,
        adminUserId: adminUser.id,
        consultantUserId: consultantUser.id,
        projectId: project.id,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
