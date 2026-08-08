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
 * Admit v1 frozen — empty PostGIS is HITL next (not auto-start).
 */

const SEQUENCE = [
  { step: "1", name: "Master inventory", state: "DONE" },
  { step: "2", name: "Source authority / provenance", state: "DONE" },
  { step: "3", name: "New PostGIS data contract", state: "FROZEN (ADR)" },
  { step: "3b", name: "Admit v1 set + layer_id contracts", state: "FROZEN" },
  { step: "4", name: "Sanerad tom PostGIS", state: "HITL NEXT" },
  { step: "5", name: "Import + validation", state: "BLOCKED until #4" },
  { step: "6", name: "Spatial layer registry", state: "BLOCKED until #5" },
  { step: "7", name: "Spatial provider", state: "BLOCKED until #5" },
  { step: "8", name: "LU broad coverage", state: "BLOCKED until #5" },
  { step: "9", name: "Performance benchmark", state: "BLOCKED until #5" },
];

const INVENTORY = [
  {
    need: "Fastighet",
    master: "LM registerytor 2026-06-28",
    auth: "MASTER",
    lu: "critical",
    admit: "ADMIT",
  },
  {
    need: "Brunnar (MM water)",
    master: "SGU brunnar 2026-06-19",
    auth: "MASTER",
    lu: "critical",
    admit: "ADMIT (MM)",
  },
  {
    need: "EBH",
    master: "LST EBH 2026-07-23",
    auth: "MASTER",
    lu: "critical",
    admit: "ADMIT (MM)",
  },
  {
    need: "Skyddad natur",
    master: "NV Naturreservat legacy-adopted",
    auth: "MASTER",
    lu: "critical",
    admit: "ADMIT (MM)",
  },
  {
    need: "Natura 2000",
    master: "NV SPA rikstäckande 2026-05-08",
    auth: "MASTER",
    lu: "high",
    admit: "ADMIT",
  },
  {
    need: "Vattenskydd",
    master: "NV VSO only (LST OOS)",
    auth: "MASTER",
    lu: "high",
    admit: "ADMIT (NV)",
  },
  {
    need: "Översvämning",
    master: "MSB översvämning nationell",
    auth: "MASTER",
    lu: "high",
    admit: "ADMIT",
  },
  {
    need: "Jord / skred",
    master: "SGU soil + landslide",
    auth: "MASTER",
    lu: "high",
    admit: "ADMIT",
  },
  {
    need: "SVAR / avrinningsområde",
    master: "SMHI SVAR2022 (not live VISS)",
    auth: "MASTER",
    lu: "high",
    admit: "ADMIT",
  },
  {
    need: "SKS nyckelbiotoper",
    master: "Skogsstyrelsen nyckelbiotoper",
    auth: "MASTER",
    lu: "high",
    admit: "ADMIT",
  },
  {
    need: "Topo water",
    master: "LM Topografi50 hydrografi",
    auth: "MASTER",
    lu: "high",
    admit: "BLOCKED (no registry)",
  },
  {
    need: "Kulturmiljö / RAÄ",
    master: "RAA lämningar GPKG (SHA retained)",
    auth: "MISSING registry",
    lu: "high",
    admit: "OUT_OF_SCOPE v1",
  },
  {
    need: "FAPI servitut",
    master: "—",
    auth: "MISSING",
    lu: "medium",
    admit: "OUT_OF_SCOPE",
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
          <Pill tone="success">ADMIT v1 FROZEN</Pill>
        </Row>
        <Text tone="secondary">
          Admit v1 set + layer_id contracts frozen. Empty PostGIS is HITL next.
          Magic Moment (9c200a7) remains acceptance for the new foundation —
          L3 stays paused. Docs: admit-v1/ADMIT-V1-SET.md
        </Text>
      </Stack>

      <Callout tone="warning" title="HITL before empty engine">
        Do not auto-start sanitize/wipe. Do not copy old tables for safety.
        Import only ADMIT rows; never OUT_OF_SCOPE / BLOCKED.
      </Callout>

      <Grid columns={3} gap={12}>
        <Stat value="1–3b" label="Inventory → Admit v1" tone="success" />
        <Stat value="4" label="Empty PostGIS (HITL)" tone="warning" />
        <Stat value="MM" label="Acceptance after import" tone="success" />
      </Grid>

      <H2>Frozen rebuild sequence</H2>
      <Table
        headers={["#", "Step", "State"]}
        rows={SEQUENCE.map((s) => [s.step, s.name, s.state])}
        rowTone={SEQUENCE.map((s) =>
          s.state.startsWith("BLOCKED")
            ? ("neutral" as const)
            : s.state.includes("FROZEN") || s.state === "DONE"
              ? ("success" as const)
              : s.state.includes("HITL")
                ? ("warning" as const)
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
          if (r.admit.startsWith("ADMIT")) return "success" as const;
          if (
            r.admit.startsWith("OUT_OF_SCOPE") ||
            r.admit.startsWith("BLOCKED") ||
            r.admit === "no auto-carry"
          )
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

      <H3>Next (HITL)</H3>
      <Stack gap={6}>
        <Text>1. Dump unique app/HITL tables</Text>
        <Text>2. Sanitize relics → cold empty PostGIS</Text>
        <Text>3. Import ADMIT rows only (identity chain)</Text>
        <Text>4. Magic Moment E2E against the new DB</Text>
        <Text tone="secondary" size="small">
          ADMIT-V1-SET.md · LAYER-ID-CONTRACTS-V1.md · skill
          mimers-postgis-cold-start
        </Text>
      </Stack>
    </Stack>
  );
}
