/** Demo-seed — använd inte som staging-bevis (se docs/qa/staging-evidence/FAS3_STAGING_EVIDENCE.md). */
import { prisma } from '../server/db/prisma';

async function seedLocalizationDemo() {
  try {
    console.log('🌱 Seeding localization demo project...');

    // 1. Get or find the admin organisation
    let org = await prisma.organisation.findFirst({
      where: { name: 'Miljobeslut Admin HQ' },
    });

    if (!org) {
      console.log('Creating test organisation...');
      org = await prisma.organisation.create({
        data: {
          name: 'Miljobeslut Admin HQ',
          orgNumber: '123456-7890',
          role: 'CLIENT',
        },
      });
    }
    console.log(`✓ Using organisation: ${org.name}`);

    // 2. Create a demo project for "Lokaliseringsutredning"
    const project = await prisma.project.create({
      data: {
        organisationId: org.id,
        propertyDesignation: 'GÄVLE BRYNÄS 1:1',
        status: 'ACTIVE',
        complianceScore: 87.5,
        environmentalScore: 78.2,
        regulatoryRiskScore: 0.45,
        fundingRating: 'HIGH',
      },
    });
    console.log(`✓ Created project: ${project.propertyDesignation}`);
    console.log(`  Project ID: ${project.id}`);

    // 3. Create project plan state (to track workflow progress)
    await prisma.projectPlanState.create({
      data: {
        projectId: project.id,
        plan: {
          workflow: 'LOCALIZATION_STUDY',
          stage: 'COMPLETED',
          progress: 100,
          siteAlternatives: [
            {
              id: 'alt-1',
              name: 'Huvudplaceringen',
              coordinates: {
                lat: 60.6758,
                lng: 17.1437,
              },
              riskLevel: 'LOW',
              waterDistance: 245,
              groundLevel: 12.5,
            },
            {
              id: 'alt-2',
              name: 'Alternativ 1 (västra tomten)',
              coordinates: {
                lat: 60.676,
                lng: 17.142,
              },
              riskLevel: 'MEDIUM',
              waterDistance: 180,
              groundLevel: 11.8,
            },
            {
              id: 'alt-3',
              name: 'Alternativ 2 (nordöstra hörnet)',
              coordinates: {
                lat: 60.678,
                lng: 17.145,
              },
              riskLevel: 'MEDIUM',
              waterDistance: 320,
              groundLevel: 13.2,
            },
          ],
          reportGenerated: true,
          reportUrl: `/projects/${project.id}/localization-report`,
          lastModified: new Date().toISOString(),
        },
      },
    });
    console.log(`✓ Created project plan state`);

    console.log('\n✅ Demo project seeded successfully!');
    console.log(`\n📍 Project details:`);
    console.log(`   - Property: ${project.propertyDesignation}`);
    console.log(`   - ID: ${project.id}`);
    console.log(`   - Status: ${project.status}`);
    console.log(`   - Compliance Score: ${project.complianceScore}%`);
    console.log(`   - Report: Ready for review`);
    console.log(`\n🎯 To view in UI, navigate to: http://localhost:3000`);
    console.log(`   And select the project from the workspace`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Seed error:', error);
    process.exit(1);
  }
}

seedLocalizationDemo();
