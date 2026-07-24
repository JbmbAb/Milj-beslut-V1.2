import { describe, expect, it, beforeAll } from 'vitest';
import { prisma } from '../../server/db/prisma';
import { getMlFeatures } from '../../server/services/aiMlFeaturesService';
import { seedGavleBrynasSguMoran, seedPropertyUnit, seedProtectedArea } from '../helpers/postgisSeed';
import { describeIfDatabaseIntegration } from './integrationTestEnv';

describeIfDatabaseIntegration('AI & ML Feature Engine - PostGIS Integration', () => {
  beforeAll(async () => {
    // Clean up existing test tables to ensure clean, isolated runs
    await prisma.$executeRaw`DELETE FROM env.sgu_soil_type_25k_100k;`;
    await prisma.$executeRaw`DELETE FROM env.protected_area;`;
    await prisma.$executeRaw`DELETE FROM env.sgu_landslide_feature;`;
    await prisma.$executeRaw`DELETE FROM env.ebh_potentiellt_fororenade_omraden;`;

    // Seed some test data to ensure clean, deterministic inputs
    await seedPropertyUnit(prisma, {
      designation: 'GÄVLE BRYNÄS 1:1',
      sourceKey: 'test-brynas-1-1',
      municipalityName: 'Gävle',
    });

    await seedProtectedArea(prisma, {
      nvrId: 'NVR-2026-0001',
      name: 'Brynäs Vattenskydd',
      protectionType: 'Vattenskyddsområde',
    });

    // Seed a second overlapping protected area to test multiple intersections simultaneously
    await prisma.$executeRaw`
      INSERT INTO env.protected_area (nvr_id, name, protection_type, geom)
      VALUES (
        'NVR-2026-0002',
        'Brynäs Naturreservat',
        'Naturreservat',
        ST_Multi(ST_Transform(
          ST_SetSRID(ST_GeomFromText('POLYGON((17.13 60.66, 17.15 60.66, 17.15 60.68, 17.13 60.68, 17.13 60.66))'), 4326),
          3006
        ))
      )
      ON CONFLICT DO NOTHING;
    `;

    await seedGavleBrynasSguMoran(prisma, { jy1Tx: 'Lera' });

    // Seed landslide hazard data (one inside the property, one close to the eastern boundary)
    await prisma.$executeRaw`
      INSERT INTO env.sgu_landslide_feature (id, geom, sl, sl_tx)
      VALUES (
        88888,
        ST_Multi(ST_Buffer(ST_Transform(
          ST_SetSRID(ST_GeomFromText('POINT(17.14 60.67)'), 4326),
          3006
        ), 1.0)),
        10,
        'Skredrisk Lera'
      )
      ON CONFLICT DO NOTHING;
    `;

    await prisma.$executeRaw`
      INSERT INTO env.sgu_landslide_feature (id, geom, sl, sl_tx)
      VALUES (
        88889,
        ST_Multi(ST_Buffer(ST_Transform(
          ST_SetSRID(ST_GeomFromText('POINT(17.153 60.67)'), 4326),
          3006
        ), 1.0)),
        10,
        'Skredrisk Lera Öst'
      )
      ON CONFLICT DO NOTHING;
    `;

    // Seed EBH contaminated sites data
    await prisma.$executeRaw`
      INSERT INTO env.ebh_potentiellt_fororenade_omraden (id, geom)
      VALUES (
        77777,
        ST_Multi(ST_Buffer(ST_Transform(
          ST_SetSRID(ST_GeomFromText('POINT(17.14 60.67)'), 4326),
          3006
        ), 1.0))
      )
      ON CONFLICT DO NOTHING;
    `;
  });

  it('Scenario 1: retrieves features for a valid property ID with overlapping soils, protected areas, and landslides', async () => {
    const result = await getMlFeatures({ propertyId: 'test-brynas-1-1' });

    expect(result.found).toBe(true);
    expect(result.property_designation).toBe('GÄVLE BRYNÄS 1:1');
    expect(result.feature_version).toBe(1);

    // Soil checks
    expect(result.soils.length).toBeGreaterThan(0);
    expect(result.soils[0].layer_label).toBe('Lera');
    expect(result.soils[0].overlap_ratio).toBeCloseTo(1.0, 1);

    // Protected areas checks (multiple)
    expect(result.protected_areas.length).toBeGreaterThanOrEqual(2);
    const nvrIds = result.protected_areas.map((p: any) => p.nvr_id);
    expect(nvrIds).toContain('NVR-2026-0001');
    expect(nvrIds).toContain('NVR-2026-0002');

    // Distance checks
    expect(result.landslides.length).toBeGreaterThan(0);
    expect(result.landslides[0].feature_label).toBe('Skredrisk Lera');
    expect(result.landslides[0].distance_meters).toBe(0);

    expect(result.contaminated_sites.length).toBeGreaterThan(0);
    expect(result.contaminated_sites[0].distance_meters).toBe(0);
  });

  it('Scenario 2: retrieves features for a custom GeoJSON polygon (no property ID)', async () => {
    const customPolygon = {
      type: 'Polygon',
      coordinates: [
        [
          [17.135, 60.665],
          [17.145, 60.665],
          [17.145, 60.675],
          [17.135, 60.675],
          [17.135, 60.665],
        ],
      ],
    };

    const result = await getMlFeatures({ geometry: customPolygon });

    expect(result.found).toBe(true);
    expect(result.property_id).toBeNull();
    expect(result.soils.length).toBeGreaterThan(0);
    expect(result.protected_areas.length).toBeGreaterThanOrEqual(2);
  });

  it('Scenario 3: applies custom buffer distance to geometry query', async () => {
    const outsidePoint = {
      type: 'Point',
      coordinates: [17.165, 60.67], // Outside the 17.13-17.15 longitude bbox (~1000m east)
    };

    // Query without buffer
    const noBufferResult = await getMlFeatures({ geometry: outsidePoint, bufferDistance: 0.0 });
    expect(noBufferResult.found).toBe(true);
    expect(noBufferResult.soils.length).toBe(0);
    expect(noBufferResult.protected_areas.length).toBe(0);

    // Query with 2000 meters buffer
    const bufferedResult = await getMlFeatures({ geometry: outsidePoint, bufferDistance: 2000.0 });
    expect(bufferedResult.found).toBe(true);
    expect(bufferedResult.protected_areas.length).toBeGreaterThan(0);
  });

  it('Scenario 4: handles property without any environmental overlaps (far away)', async () => {
    const customFarPoint = {
      type: 'Point',
      coordinates: [18.06, 59.33], // Stockholm
    };

    const result = await getMlFeatures({ geometry: customFarPoint });
    expect(result.found).toBe(true);
    expect(result.soils.length).toBe(0);
    expect(result.protected_areas.length).toBe(0);
    expect(result.landslides.length).toBe(0);
    expect(result.contaminated_sites.length).toBe(0);
  });

  it('Scenario 5: verifies distance thresholds and boundary checks', async () => {
    // Point outside 250m but inside 500m of the seeded landslide POINT(17.153 60.67)
    // 17.156 longitude is approx ~330m away east from protected area bounds, and ~162m east of Landslide Öst
    const boundaryPoint = {
      type: 'Point',
      coordinates: [17.156, 60.67],
    };

    const result = await getMlFeatures({ geometry: boundaryPoint });

    // protected_areas are queried using ST_DWithin 250m.
    // At ~330m away, it should find 0 matches
    expect(result.protected_areas.length).toBe(0);

    // But landslide is within 500m, so it should find it!
    expect(result.landslides.length).toBeGreaterThan(0);
    expect(result.landslides[0].distance_meters).toBeLessThan(500);
  });

  it('Scenario 6: handles missing or invalid inputs gracefully', async () => {
    const result = await getMlFeatures({});
    expect(result.found).toBe(false);
    expect(result.property_id).toBeNull();
  });

  it('Scenario 7: handles performance and concurrency smoothly under high load', async () => {
    const promises = Array.from({ length: 15 }).map(() => getMlFeatures({ propertyId: 'test-brynas-1-1' }));

    const results = await Promise.all(promises);
    expect(results.length).toBe(15);
    for (const res of results) {
      expect(res.found).toBe(true);
      expect(res.protected_areas.length).toBeGreaterThanOrEqual(2);
    }
  });
});
