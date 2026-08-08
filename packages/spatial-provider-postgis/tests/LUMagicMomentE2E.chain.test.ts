/**
 * E2E Magic Moment against local PostGIS — no SpatialProvider / CAS / kernel stubs.
 *
 * property_unit (PostGIS)
 *   → WGS84 centroid
 *   → GenerateLocalizationReportUseCase
 *   → SpatialProviderPostGIS / ST_DWithin
 *   → SpatialEvidenceArtifact → CAS
 *   → ExecutionKernel / rules
 *   → LocalizationAssessmentArtifact
 *   → re-query CAS identity
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { GenerateLocalizationReportUseCase } from "../../../src/application/generate-localization-report.usecase";
import { SpatialProviderPostGIS } from "../src/SpatialProviderPostGIS";
import { MimersIntegration } from "../../mps-runtime/src/mimers/index";
import { prisma } from "../../../server/db/prisma";
import { lookupPropertyByDesignationFromPostgis } from "../../../server/services/propertyUnitService";
import { mapLookupResultToPropertyInfo } from "../../../src/ui/api-client/geo.client";

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://riskguard:password@127.0.0.1:5432/riskguard_test?sslmode=disable";

const DESIGNATION = "VÄSTERÅS 1:1";
const SOURCE_KEY = "e2e-magic-moment-vasteras-1-1";
const EASTING = 591234;
const NORTHING = 6612345;
const PROJECT_ID = "proj-e2e-lu-magic-moment";

describe("E2E LU Magic Moment — PostGIS → assessment (no mocks)", () => {
  let lat = 0;
  let lng = 0;
  let testOrgId = "";
  let testProjectId = "";
  const testUser = {
    id: "user-e2e-lu-magic",
    bankidId: "bankid-e2e-lu-magic",
    organisationId: "placeholder",
    role: "ADMIN" as const,
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.TEST_DATABASE_URL = DB_URL;
    process.env.LOCALIZATION_STRICT_SOURCES = "false";
    process.env.PROPERTY_LOOKUP_MODE = "postgis";

    const client = new Client({ connectionString: DB_URL });
    await client.connect();

    await client.query("DELETE FROM env.sgu_well WHERE id >= 999910 AND id < 999920");
    await client.query(
      "DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE id >= 999910 AND id < 999920",
    );
    await client.query("DELETE FROM env.protected_area WHERE nvr_id = 'NVR-E2E-MAGIC'");
    await client.query("DELETE FROM core.property_unit WHERE source_key = $1", [SOURCE_KEY]);

    // Property at Magic Moment SWEREF point (critical path: designation → geom)
    await client.query(
      `
      INSERT INTO core.property_unit (
        source_key, designation, designation_norm,
        municipality_name, source_dataset, geom
      ) VALUES (
        $1, $2, core.normalize_designation($2),
        'Västerås', 'e2e-magic-moment',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($3, $4), 3006), 25))
      )
      `,
      [SOURCE_KEY, DESIGNATION, EASTING, NORTHING],
    );

    await client.query(
      `
      INSERT INTO env.sgu_well (id, geom)
      VALUES (999910, ST_SetSRID(ST_MakePoint($1, $2), 3006))
      `,
      [EASTING, NORTHING],
    );
    await client.query(
      `
      INSERT INTO env.ebh_potentiellt_fororenade_omraden (id, geom)
      VALUES (999910, ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 3006), 10)))
      `,
      [EASTING, NORTHING],
    );
    await client.query(
      `
      INSERT INTO env.protected_area (nvr_id, name, protection_type, geom)
      VALUES (
        'NVR-E2E-MAGIC',
        'E2E Magic Protected Area',
        'Naturreservat',
        ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($1, $2), 3006), 10))
      )
      `,
      [EASTING, NORTHING],
    );

    const wgs = await client.query<{ lat: number; lng: number }>(
      `
      SELECT ST_Y(g) AS lat, ST_X(g) AS lng
      FROM ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 3006), 4326) AS g
      `,
      [EASTING, NORTHING],
    );
    lat = Number(wgs.rows[0]?.lat);
    lng = Number(wgs.rows[0]?.lng);
    await client.end();

    expect(Number.isFinite(lat) && Number.isFinite(lng)).toBe(true);

    const org = await prisma.organisation.upsert({
      where: { orgNumber: "E2E-LU-MAGIC-ORG" },
      create: {
        name: "E2E LU Magic Org",
        orgNumber: "E2E-LU-MAGIC-ORG",
        role: "CLIENT",
      },
      update: {},
    });
    testOrgId = org.id;
    testUser.organisationId = testOrgId;

    await prisma.user.upsert({
      where: { bankidId: testUser.bankidId },
      create: {
        id: testUser.id,
        bankidId: testUser.bankidId,
        organisationId: testOrgId,
        role: "ADMIN",
      },
      update: { organisationId: testOrgId },
    });

    const project = await prisma.project.create({
      data: {
        id: PROJECT_ID,
        organisationId: testOrgId,
        propertyDesignation: DESIGNATION,
        status: "ACTIVE",
      },
    });
    testProjectId = project.id;

    await prisma.projectMember.create({
      data: {
        projectId: testProjectId,
        userId: testUser.id,
        accessRole: "OWNER",
      },
    });
  }, 60_000);

  afterAll(async () => {
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    await client.query("DELETE FROM env.sgu_well WHERE id >= 999910 AND id < 999920");
    await client.query(
      "DELETE FROM env.ebh_potentiellt_fororenade_omraden WHERE id >= 999910 AND id < 999920",
    );
    await client.query("DELETE FROM env.protected_area WHERE nvr_id = 'NVR-E2E-MAGIC'");
    await client.query("DELETE FROM core.property_unit WHERE source_key = $1", [SOURCE_KEY]);
    await client.end();

    if (testProjectId) {
      await prisma.projectMember.deleteMany({ where: { projectId: testProjectId } });
      await prisma.propertyAccessLog.deleteMany({ where: { projectId: testProjectId } }).catch(() => undefined);
      await prisma.project.deleteMany({ where: { id: testProjectId } });
    }
    await prisma.user.deleteMany({ where: { id: testUser.id } });
    if (testOrgId) {
      await prisma.organisation.delete({ where: { id: testOrgId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }, 60_000);

  it("property → PostGIS evidence → CAS → assessment end-to-end", async () => {
    // 1) Property lookup (real PostGIS core.property_unit)
    const lookupRaw = await lookupPropertyByDesignationFromPostgis(
      {
        projectId: testProjectId,
        propertyDesignation: DESIGNATION,
        purpose: "E2E_LU_MAGIC_MOMENT",
      },
      testUser,
    );
    expect(lookupRaw.designation).toMatch(/VÄSTERÅS/i);
    expect(lookupRaw.source).toBe("postgis");
    expect(lookupRaw.geometry).toBeDefined();

    const propertyInfo = mapLookupResultToPropertyInfo(lookupRaw as Record<string, unknown>);
    expect(propertyInfo.centroid?.lat).toBeDefined();
    expect(propertyInfo.centroid?.lng).toBeDefined();
    const siteLat = propertyInfo.centroid!.lat;
    const siteLng = propertyInfo.centroid!.lng;
    // Centroid must be near seeded Magic Moment point (WGS84)
    expect(siteLat).toBeCloseTo(lat, 2);
    expect(siteLng).toBeCloseTo(lng, 2);

    // 2) LU API path = GenerateLocalizationReport usecase (production entry)
    const useCase = new GenerateLocalizationReportUseCase();
    const siteId = "site-e2e-magic-vasteras";
    const report = await useCase.execute({
      projectId: testProjectId,
      userId: testUser.id,
      user: testUser,
      siteAlternatives: [
        {
          id: siteId,
          name: DESIGNATION,
          lat: siteLat,
          lng: siteLng,
        },
      ],
    });

    const analysis = report.siteAnalyses[0];
    expect(analysis).toBeDefined();
    const motor = analysis.executionMotor;
    expect(motor).toBeDefined();
    expect(motor!.admitted).toBe(true);
    expect(motor!.property_context_id).toBe(`prop-${siteId}`);
    expect(motor!.assessment_artifact_id).toBeTruthy();
    expect(motor!.finding_ids.length).toBeGreaterThanOrEqual(2);

    // Findings from real evidence → rules
    const actionsAndNotes = [
      ...(analysis.complianceAnalysis.requiredActions ?? []),
      ...(analysis.complianceAnalysis.notes ?? []),
    ].join("\n");
    expect(actionsAndNotes).toMatch(/LU-WATER-001/);
    expect(actionsAndNotes).toMatch(/LU-EBH-001/);

    // 3) CAS holds LocalizationAssessmentArtifact + property context
    const mimers = await MimersIntegration.create();
    const propCtx = await mimers.artifactRepository.resolve<{
      payload: { coordinates: readonly [number, number]; property_ref: string };
    }>({
      artifact_id: motor!.property_context_id!,
      artifact_type: "LU_PROPERTY_CONTEXT",
    });
    // Centroid of buffered property_unit ≈ seed point (SWEREF99 TM meters)
    expect(Math.abs(propCtx.payload.coordinates[0] - NORTHING)).toBeLessThan(5);
    expect(Math.abs(propCtx.payload.coordinates[1] - EASTING)).toBeLessThan(5);

    const assessment = await mimers.artifactRepository.resolve<{
      artifact_type: string;
      payload: {
        evidence_refs: Array<{ artifact_id: string }>;
        findings: Array<{ rule_id: string }>;
      };
    }>({
      artifact_id: motor!.assessment_artifact_id!,
      artifact_type: "LOCALIZATION_ASSESSMENT",
    });
    expect(assessment.artifact_type).toBe("LOCALIZATION_ASSESSMENT");
    expect(assessment.payload.evidence_refs.length).toBeGreaterThanOrEqual(3);
    const ruleIds = assessment.payload.findings.map((f) => f.rule_id);
    expect(ruleIds).toContain("LU-WATER-001");
    expect(ruleIds).toContain("LU-EBH-001");

    // 4) Three layers queried for real — evidence in CAS
    for (const ref of assessment.payload.evidence_refs) {
      const ev = await mimers.artifactRepository.resolve<{
        artifact_type: string;
        content_hash: { value: string };
        payload: { layer_ref: { layer_id: string }; geometry: unknown };
      }>({
        artifact_id: ref.artifact_id,
        artifact_type: "SPATIAL_EVIDENCE",
      });
      expect(ev.artifact_type).toBe("SPATIAL_EVIDENCE");
      expect(ev.content_hash.value).toMatch(/^[a-f0-9]{64}$/);
      expect(ev.payload.geometry).toBeTruthy();
    }
    const layers = new Set(
      (
        await Promise.all(
          assessment.payload.evidence_refs.map((ref) =>
            mimers.artifactRepository.resolve<{
              payload: { layer_ref: { layer_id: string } };
            }>({
              artifact_id: ref.artifact_id,
              artifact_type: "SPATIAL_EVIDENCE",
            }),
          ),
        )
      ).map((e) => e.payload.layer_ref.layer_id),
    );
    expect(layers.has("water")).toBe(true);
    expect(layers.has("ebh")).toBe(true);
    expect(layers.has("protected_area")).toBe(true);

    // 5) Re-query reuses same CAS artifact ids (WORM / identity)
    const provider = new SpatialProviderPostGIS(DB_URL, mimers.artifactRepository);
    try {
      const propRef = {
        artifact_id: motor!.property_context_id!,
        artifact_type: "LU_PROPERTY_CONTEXT" as const,
      };
      const first = await provider.query({
        property_ref: propRef,
        buffer_distance_meters: 500,
        layers: [
          { name: "water", version_hash: "v1.0" },
          { name: "ebh", version_hash: "v1.0" },
          { name: "protected_area", version_hash: "v1.0" },
        ],
      });
      const second = await provider.query({
        property_ref: propRef,
        buffer_distance_meters: 500,
        layers: [
          { name: "water", version_hash: "v1.0" },
          { name: "ebh", version_hash: "v1.0" },
          { name: "protected_area", version_hash: "v1.0" },
        ],
      });
      expect(second.map((e) => e.artifact_id).sort()).toEqual(
        first.map((e) => e.artifact_id).sort(),
      );
      expect(second.map((e) => e.content_hash.value).sort()).toEqual(
        first.map((e) => e.content_hash.value).sort(),
      );
    } finally {
      await provider.close();
    }

    // 6) Shape LuWorkspace renders (assessment / property context / findings)
    expect(motor!.assessment_artifact_id).toMatch(/^assess-/);
    expect(motor!.property_context_id).toMatch(/^prop-/);
    expect(analysis.complianceAnalysis.overallRisk).toMatch(/HIGH|MEDIUM|LOW/);
  }, 120_000);
});
