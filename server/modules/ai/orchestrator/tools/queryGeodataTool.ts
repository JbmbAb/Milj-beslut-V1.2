import { FunctionDeclaration, Type } from '@google/genai';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const queryGeodataDeclaration: FunctionDeclaration = {
  name: 'queryGeodata',
  description: 'Används för att ta reda på vad som finns på en specifik plats (koordinater). Söker i PostGIS efter geotekniska förutsättningar, jordarter, skyddade områden och annat miljöpåverkande underlag i radien.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      latitude: {
        type: Type.NUMBER,
        description: 'Breddgrad (WGS84 Latitud, t.ex. 59.3293)'
      },
      longitude: {
        type: Type.NUMBER,
        description: 'Längdgrad (WGS84 Longitud, t.ex. 18.0686)'
      },
      radiusMeters: {
        type: Type.NUMBER,
        description: 'Sökradie i meter. Standard är 100. Max är 5000.'
      }
    },
    required: ['latitude', 'longitude'],
  },
};

export async function queryGeodataHandler(args: { latitude: number; longitude: number; radiusMeters?: number }) {
  const { latitude, longitude } = args;

  // Clamp search radius between 1 and 5000 meters to prevent database timeouts
  const requestedRadius = args.radiusMeters !== undefined ? args.radiusMeters : 100;
  const radius = Math.min(5000, Math.max(1, requestedRadius));

  try {
    const tablesToCheck = ['sgu_soil_type_25k_100k', 'nv_vardetrakter', 'sgu_fastmark_stabilitet', 'sgu_permeability'];
    const results: any = {};

    for (const table of tablesToCheck) {
      const tableExists = await prisma.$queryRawUnsafe<any[]>(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
        table
      );
      if (!tableExists[0].exists) continue;

      const q = `
        SELECT *
        FROM "${table}"
        WHERE ST_DWithin(
          geom,
          ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 3006),
          $3
        )
        LIMIT 3;
      `;
      const hits = await prisma.$queryRawUnsafe<any[]>(q, longitude, latitude, radius);

      if (hits.length > 0) {
        results[table] = hits.map(hit => {
          const { geom, id, ...rest } = hit;
          return rest;
        });
      }
    }

    if (Object.keys(results).length === 0) {
      return {
        message: `Inga skyddade områden, jordartsdata eller geotekniska förutsättningar hittades inom ${radius} meter från koordinaterna (Latitud: ${latitude}, Longitud: ${longitude}).`
      };
    }

    return results;
  } catch (err: any) {
    console.error('queryGeodata error:', err);
    return { error: 'Misslyckades med att hämta spatial geodata.', details: err.message };
  }
}
