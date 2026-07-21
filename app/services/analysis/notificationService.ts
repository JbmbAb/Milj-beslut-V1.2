import { prisma } from '../../../db.server';

export async function screenCNotification(geometry: any) {
  const layers = (await prisma.$queryRawUnsafe(
    'SELECT layer FROM geodata WHERE ST_Intersects(geom, ST_GeomFromGeoJSON($1))',
    JSON.stringify(geometry)
  )) as any[];

  if (layers && layers.length > 0) {
    return {
      isSensitiveArea: true,
      intersectingLayers: layers.map((l) => l.layer),
      permitRequired: true,
      riskSummary: `Verksamheten krockar med ${layers.map((l) => l.layer).join(', ')}. Miljökonsekvensbeskrivning kan krävas.`,
    };
  }

  return {
    isSensitiveArea: false,
    intersectingLayers: [],
    permitRequired: false,
    riskSummary: 'Inga omedelbara spatiala hinder identifierade.',
  };
}
