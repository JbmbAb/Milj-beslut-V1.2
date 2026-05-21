import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const GROUND_COLLECTION_URL =
  'https://api.sgu.se/oppnadata/jordarter1miljon/ogc/features/v1/collections/grundlager/items';
const LANDSLIDE_COLLECTION_URL =
  'https://api.sgu.se/oppnadata/jordskred-raviner/ogc/features/v1/collections/jordskred-raviner/items';

async function fetchCollectionMeta(url: string) {
  const targetUrl = new URL(url);
  targetUrl.searchParams.set('limit', '1');
  const res = await fetch(targetUrl, {
    headers: { Accept: 'application/geo+json' },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return (await res.json()) as any;
}

async function check() {
  try {
    const groundResult = await prisma.$queryRawUnsafe<any[]>('SELECT count(*) as count FROM env.sgu_ground_layer');
    const landslideResult = await prisma.$queryRawUnsafe<any[]>('SELECT count(*) as count FROM env.sgu_landslide_feature');
    
    console.log('Database Ground count:', groundResult[0].count);
    console.log('Database Landslide count:', landslideResult[0].count);

    const groundMeta = await fetchCollectionMeta(GROUND_COLLECTION_URL);
    const landslideMeta = await fetchCollectionMeta(LANDSLIDE_COLLECTION_URL);

    console.log('API Ground matched:', groundMeta.numberMatched);
    console.log('API Landslide matched:', landslideMeta.numberMatched);

  } catch (e: any) {
    console.error('Error checking counts:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

check();
