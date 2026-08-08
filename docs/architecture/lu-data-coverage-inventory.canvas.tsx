import {
  Callout,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
} from "cursor/canvas";

/**
 * Strategic inventory for sanerad PostGIS rebuild.
 * No rebuild / import / L3 until data contract is frozen.
 */

const SEQUENCE = [
  { step: "1", name: "Master inventory", state: "IN PROGRESS" },
  { step: "2", name: "Source authority / provenance", state: "IN PROGRESS" },
  { step: "3", name: "New PostGIS data contract", state: "FROZEN (ADR)" },
  { step: "4", name: "Sanerad tom PostGIS", state: "BLOCKED" },
  { step: "5", name: "Import + validation", state: "BLOCKED" },
  { step: "6", name: "Spatial layer registry", state: "BLOCKED" },
  { step: "7", name: "Spatial provider", state: "BLOCKED" },
  { step: "8", name: "LU broad coverage", state: "BLOCKED" },
  { step: "9", name: "Performance benchmark", state: "BLOCKED" },
];

const INVENTORY = [
  {
    need: "Fastighet",
    master: "LM STAC → registerytor → property_unit",
    auth: "MASTER",
    lu: "critical",
    admit: "yes",
  },
  {
    need: "Brunnar (MM water)",
    master: "SGU → sgu_well",
    auth: "MASTER",
    lu: "critical",
    admit: "yes (MM)",
  },
  {
    need: "EBH",
    master: "LST → ebh_potentiellt_fororenade_omraden",
    auth: "MASTER",
    lu: "critical",
    admit: "yes (MM)",
  },
  {
    need: "Skyddad natur",
    master: "NV → protected_area",
    auth: "MASTER",
    lu: "critical",
    admit: "yes (MM)",
  },
  {
    need: "Natura 2000",
    master: "NV → natura2000_area",
    auth: "MASTER",
    lu: "high",
    admit: "candidate",
  },
  {
    need: "Vattenskydd",
    master: "NV and/or LST → water_protection_area",
    auth: "MASTER*",
    lu: "high",
    admit: "resolve dual source",
  },
  {
    need: "Översvämning",
    master: "MSB → climate.flood_risk_area",
    auth: "MASTER",
    lu: "high",
    admit: "candidate",
  },
  {
    need: "Jord / skred",
    master: "SGU soil + landslide",
    auth: "MASTER",
    lu: "high",
    admit: "candidate",
  },
  {
    need: "VISS",
    master: "VISS harvest → env/viss",
    auth: "MASTER",
    lu: "high",
    admit: "candidate",
  },
  {
    need: "Kulturmiljö / RAÄ",
    master: "RAA/ folder exists; no IMPORT_REGISTRY",
    auth: "MISSING",
    lu: "high",
    admit: "block",
  },
  {
    need: "FAPI servitut",
    master: "—",
    auth: "MISSING",
    lu: "medium",
    admit: "parked",
  },
  {
    need: "Live API / Millbygård paths",
    master: "not master SoT",
    auth: "LEGACY / LIVE_ONLY",
    lu: "—",
    admit: "no auto-carry",
  },
];

export default function LuDataCoverageInventory() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 1140 }}>
      <Stack gap={8}>
        <Row gap={12} style={{ alignItems: "center" }}>
          <H1>Master inventory → sanerad PostGIS</H1>
          <Pill tone="warning">NO REBUILD YET</Pill>
        </Row>
        <Text tone="secondary">
          PostGIS is a disposable projection. Freeze inventory + authority +
          contract before any empty database. Magic Moment (9c200a7) stays
          acceptance test for the new foundation — L3 remains paused.
        </Text>
      </Stack>

      <Callout tone="danger" title="Do not invert">
        Do not build new PostGIS directly after inventory. Do not copy old
        tables for safety. Do not treat old PostGIS counts as admit criteria.
      </Callout>

      <Grid columns={3} gap={12}>
        <Stat value="1–3" label="Active phase (inventory → contract)" tone="info" />
        <Stat value="4–9" label="Blocked until contract freeze" tone="warning" />
        <Stat value="MM" label="Acceptance test after import" tone="success" />
      </Grid>

      <H2>Frozen rebuild sequence</H2>
      <Table
        headers={["#", "Step", "State"]}
        rows={SEQUENCE.map((s) => [s.step, s.name, s.state])}
        rowTone={SEQUENCE.map((s) =>
          s.state.startsWith("BLOCKED")
            ? ("neutral" as const)
            : s.state.includes("FROZEN")
              ? ("success" as const)
              : ("info" as const),
        )}
      />

      <Divider />

      <H2>Source inventory (LU-oriented)</H2>
      <Text tone="secondary" size="small">
        Authority from GEO_Master_Archive + IMPORT_REGISTRY — not from current
        PostGIS. Full table: docs/architecture/MASTER-SPATIAL-SOURCE-INVENTORY.md
      </Text>
      <Table
        headers={["Need", "Master / path", "Authority", "LU value", "Admit v1"]}
        rows={INVENTORY.map((r) => [
          r.need,
          r.master,
          r.auth,
          r.lu,
          r.admit,
        ])}
        rowTone={INVENTORY.map((r) => {
          if (r.admit.startsWith("yes")) return "success" as const;
          if (r.auth === "MISSING" || r.admit === "no auto-carry")
            return "danger" as const;
          return "neutral" as const;
        })}
      />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader>Contract fields (per layer)</CardHeader>
          <CardBody>
            <Text>
              layer_id · source_id · source_version · version_hash · srid ·
              geometry_type · validity_rules · provenance · import_timestamp
            </Text>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>Must not auto-carry</CardHeader>
          <CardBody>
            <Text>
              Legacy derived tables, temporary caches, old API projections,
              manual copies, Millbygård local paths, undocumented env clutter.
            </Text>
          </CardBody>
        </Card>
      </Grid>

      <H3>Next (still no empty PostGIS)</H3>
      <Stack gap={6}>
        <Text>
          1. Manifest/SHA completeness on Admit v1 yes/candidate rows
        </Text>
        <Text>2. Resolve dual vattenskydd source (NV vs LST)</Text>
        <Text>
          3. RAA: register in IMPORT_REGISTRY or keep blocked for v1
        </Text>
        <Text>
          4. Freeze admit-set v1 layer contracts — then sanitize empty engine
        </Text>
        <Text tone="secondary" size="small">
          ADR-POSTGIS-REBUILD-DATA-CONTRACT.md ·
          MASTER-SPATIAL-SOURCE-INVENTORY.md · Magic Moment acceptance unchanged
        </Text>
      </Stack>
    </Stack>
  );
}
