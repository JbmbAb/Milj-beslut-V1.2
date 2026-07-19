import { prisma } from '../../../db/prisma';

export async function getPostgisExtendedHealth(): Promise<{
  postgis: { version: string; sridCount: number; gistIndexCount: number };
  extensions: Array<{ extname: string; extversion: string }>;
  lastSpatialMigration: { fileName: string; appliedAt: Date; durationMs: number | null } | null;
  checkedAt: string;
}> {
  const versionRows = await prisma.$queryRaw<Array<{ postgis_full_version: string }>>`
    SELECT postgis_full_version()
  `;
  const postgisVersion = versionRows[0]?.postgis_full_version ?? 'unknown';

  const sridRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM spatial_ref_sys
  `;
  const sridCount = Number(sridRows[0]?.count ?? 0);

  const gistRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM pg_indexes
    WHERE indexdef ILIKE '%USING gist%'
  `;
  const gistIndexCount = Number(gistRows[0]?.count ?? 0);

  const extensionRows = await prisma.$queryRaw<
    Array<{ extname: string; extversion: string }>
  >`SELECT extname, extversion FROM pg_extension ORDER BY extname`;

  type MigrationRow = { fileName: string; appliedAt: Date; durationMs: number | null };
  let lastMigration: MigrationRow | null = null;
  try {
    const migrationRows = await prisma.$queryRaw<Array<MigrationRow>>`
      SELECT "fileName", "appliedAt", "durationMs"
      FROM public.spatial_migrations
      ORDER BY "appliedAt" DESC
      LIMIT 1
    `;
    lastMigration = migrationRows[0] ?? null;
  } catch {
    lastMigration = null;
  }

  return {
    postgis: {
      version: postgisVersion,
      sridCount,
      gistIndexCount,
    },
    extensions: extensionRows,
    lastSpatialMigration: lastMigration,
    checkedAt: new Date().toISOString(),
  };
}
