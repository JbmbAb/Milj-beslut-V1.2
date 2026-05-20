import { json, type ActionFunctionArgs } from '@remix-run/node';
import { prisma } from '~/db.server';

// Mappning från NMD-kod till läsbar text enligt Naturvårdsverkets specifikation.
const NMD_CLASSES: Record<number, string> = {
  11: 'Skog',
  12: 'Öppen skog/hygge',
  21: 'Jordbruksmark',
  31: 'Öppen våtmark',
  32: 'Trädbevuxen våtmark',
  41: 'Bebyggelse',
  51: 'Vatten',
};

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const { lat, lng } = await request.json();

  if (!lat || !lng) {
    return json({ error: 'Missing coordinates' }, { status: 400 });
  }

  try {
    // Fråga PostGIS för att få rastervärdet vid den angivna punkten.
    // Punkten transformeras från WGS84 (4326) till SWEREF99TM (3006) för att matcha rastrets CRS.
    const result: { value: number }[] = await prisma.$queryRaw`
      SELECT ST_Value(
        rast,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      ) as value
      FROM env.marktacke
      WHERE ST_Intersects(
        rast,
        ST_Transform(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326), 3006)
      );
    `;

    if (!result || result.length === 0 || result[0].value === null) {
      return json({ description: 'Ingen marktäckedata hittades för denna punkt.' });
    }

    const value = result[0].value;
    const description = NMD_CLASSES[value] || `Okänd kod (${value})`;

    return json({ value, description });
  } catch (error) {
    console.error('Marktacke query error:', error);
    return json({ error: 'Database query failed', details: String(error) }, { status: 500 });
  }
}
