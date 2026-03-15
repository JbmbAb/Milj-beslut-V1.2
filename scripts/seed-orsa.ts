
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log("Creating/Updating Admin & Orsa Project...");
  
  const org = await prisma.organisation.upsert({
    where: { orgNumber: '123456-7890' },
    update: {},
    create: {
      name: 'Miljobeslut Admin HQ',
      orgNumber: '123456-7890',
    }
  });

  const admin = await prisma.user.upsert({
    where: { bankidId: 'admin:admin' },
    update: { role: 'ADMIN', organisationId: org.id },
    create: {
      bankidId: 'admin:admin',
      role: 'ADMIN',
      organisationId: org.id
    }
  });

  const orsaProject = await prisma.project.create({
    data: {
      propertyDesignation: 'ORSA STACKMORA 3:12',
      status: 'ACTIVE',
      organisationId: org.id,
      members: {
        create: {
          userId: admin.id,
          accessRole: 'OWNER'
        }
      }
    }
  });

  console.log("SUCCESS!");
  console.log("Admin User ID:", admin.id);
  console.log("Orsa Project ID:", orsaProject.id);
}

main().finally(() => prisma.$disconnect());
