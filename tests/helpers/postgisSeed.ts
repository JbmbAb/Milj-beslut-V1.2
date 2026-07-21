import type { PrismaClient } from '@prisma/client';

/** Bbox around Gävle Brynäs test fixture (WGS84). */
export const GAVLE_BRYNAS_BBOX = {
  minLng: 17.13,
  minLat: 60.66,
  maxLng: 17.15,
  maxLat: 60.68,
} as const;

export async function seedPropertyUnit(
  prisma: PrismaClient,
  params: {
    designation: string;
    sourceKey: string;
    municipalityName?: string;
  },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO core.property_unit (
      source_key, designation, designation_norm,
      municipality_name, source_dataset, geom
    ) VALUES (
      ${params.sourceKey},
      ${params.designation},
      core.normalize_designation(${params.designation}),
      ${params.municipalityName ?? 'Gävle'},
      'test-fixture',
      ST_Multi(ST_Transform(
        ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
        3006
      ))
    )
    ON CONFLICT (source_key) DO UPDATE SET
      designation = EXCLUDED.designation,
      designation_norm = EXCLUDED.designation_norm,
      geom = EXCLUDED.geom;
  `;
}

export async function seedProtectedArea(
  prisma: PrismaClient,
  params: { nvrId: string; name: string; protectionType: string },
): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO env.protected_area (nvr_id, name, protection_type, geom)
    VALUES (
      ${params.nvrId},
      ${params.name},
      ${params.protectionType},
      ST_Multi(ST_Transform(
        ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
        3006
      ))
    )
    ON CONFLICT DO NOTHING;
  `;
}

export async function seedSguWell(prisma: PrismaClient, lng: number, lat: number): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO env.sgu_well (geom)
    VALUES (ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006));
  `;
}
