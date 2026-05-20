import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';
import { prisma } from '~/db.server';

// Skyddsavstånd i meter för vattenförekomster (kan justeras)
const WATER_BODY_BUFFER_METERS = 100;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { lat, lng } = await request.json();

  if (!lat || !lng) {
    return json({ error: 'Missing coordinates' }, { status: 400 });
  }

  try {
    const hits: { name: string; water_type: string; status_ecological: string; distance: number }[] =
      await prisma.$queryRaw`
      SELECT
        name,
        water_type,
        status_ecological,
        ST_Distance(
            geom,
            ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
        ) as distance
      FROM "hydro"."water_body"
      WHERE ST_DWithin(
        geom,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006),
        ${WATER_BODY_BUFFER_METERS}
      )
      ORDER BY distance ASC
      LIMIT 5;
    `;

    return json({
      hits,
      hasWaterRisk: Array.isArray(hits) && hits.length > 0,
      buffer_meters: WATER_BODY_BUFFER_METERS,
    });
  } catch (error) {
    console.error('Water audit error:', error);
    return json({ error: 'Database query failed', details: String(error) }, { status: 500 });
  }
}
