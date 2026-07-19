import { apiClient } from './apiClient';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface SatelliteSearchOptions {
  projectId: string;
  daysBack?: number;
  maxCloudCover?: number;
}

export interface StacFeature {
  id: string;
  properties: {
    datetime: string;
    'eo:cloud_cover': number;
    platform: string;
    's2:product_type': number;
  };
  bbox: number[];
  assets: {
    thumbnail?: { href: string };
  };
}

export class SatelliteService {
  private static STAC_ENDPOINT = 'https://catalogue.dataspace.copernicus.eu/stac/search';

  /**
   * Söker efter Sentinel-2 scener över ett projekts område
   */
  async findScenes(options: SatelliteSearchOptions) {
    const { projectId, daysBack = 60, maxCloudCover = 20 } = options;

    // 1. Hämta projektets position/geometri
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { planState: true }
    });

    if (!project || !project.planState) {
      throw new Error(`Project ${projectId} not found or has no plan state`);
    }

    const plan = project.planState.plan as any;
    const location = plan.location;

    if (!location || !location.lat || !location.lng) {
      throw new Error(`Project ${projectId} missing location coordinates`);
    }

    // Skapa en enkel BBOX kring punkten för sökning (ca 5x5 km)
    const buffer = 0.025;
    const bbox = [
      location.lng - buffer,
      location.lat - buffer,
      location.lng + buffer,
      location.lat + buffer
    ];

    const dateStart = new Date();
    dateStart.setDate(dateStart.getDate() - daysBack);
    const dateStr = `${dateStart.toISOString()}/${new Date().toISOString()}`;

    // 2. Anropa Copernicus STAC API
    const searchBody = {
      bbox,
      datetime: dateStr,
      collections: ['SENTINEL-2'],
      limit: 10,
      query: {
        'eo:cloud_cover': { lt: maxCloudCover },
        's2:product_type': { eq: 'L2A' } // Bottom-of-atmosphere reflectance
      }
    };

    console.log(`[SatelliteService] Searching scenes for project ${projectId}...`, JSON.stringify(searchBody, null, 2));
    
    const response = await apiClient.post<{ features: StacFeature[], context?: any }>(
      SatelliteService.STAC_ENDPOINT,
      searchBody
    );

    console.log(`[SatelliteService] API Response context:`, JSON.stringify(response.context, null, 2));

    const scenes = response.features || [];
    
    // 3. Spara metadata i databasen
    const savedScenes = await Promise.all(
      scenes.map(async (feat) => {
        return prisma.satelliteScene.upsert({
          where: { sceneId: feat.id },
          create: {
            sceneId: feat.id,
            capturedAt: new Date(feat.properties.datetime),
            cloudCoverPercentage: feat.properties['eo:cloud_cover'],
            platform: feat.properties.platform,
            productType: 'L2A',
            thumbnailUrl: feat.assets.thumbnail?.href,
            bbox: feat.bbox as any
          },
          update: {
            cloudCoverPercentage: feat.properties['eo:cloud_cover'],
            thumbnailUrl: feat.assets.thumbnail?.href
          }
        });
      })
    );

    return savedScenes;
  }

  /**
   * Förbereder en analys (NDVI/RGB) för en scen
   * Obs: Kräver Sentinel Hub API-nyckel för faktisk bildgenerering
   */
  async queueAnalysis(projectId: string, sceneId: string, type: 'NDVI' | 'RGB') {
    const scene = await prisma.satelliteScene.findUnique({ where: { sceneId } });
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    // Här läggs logik för att anropa Sentinel Hub Process API
    // För en PoC sparar vi bara en placeholder-analys
    const analysis = await prisma.satelliteAnalysis.create({
      data: {
        projectId,
        sceneId: scene.id,
        analysisType: type,
        resultMetadata: { status: 'PENDING', message: 'Analysis queued for processing' },
        observedAt: scene.capturedAt
      }
    });

    return analysis;
  }
}

export const satelliteService = new SatelliteService();
