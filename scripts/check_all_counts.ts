import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = [
    'env.protected_area',
    'env.natura2000_area',
    'climate.flood_risk_area',
    'env.water_catchment',
    'env.land_cover',
    'env.wetland',
    'env.habitat_type',
    'env.national_interest',
    'culture.monument',
    'env.forest_analytics',
    'env.noise_area',
    'env.geophysics',
    'climate.smhi_station',
  ];
  for (const table of tables) {
    try {
      const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) FROM ${table}`);
      console.log(`${table}:`, result);
    } catch {
      console.log(`${table}: Error or not found`);
    }
  }
  await prisma.$disconnect();
}

main();
