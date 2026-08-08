import {
  BarChart,
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

const GENERATED_AT = "2026-08-08T06:23:56.969Z";
const BASELINE = "9c200a7";

const COUNTS = [
  { table: "core.property_unit", rows: 1 },
  { table: "env.sgu_well", rows: 2 },
  { table: "env.ebh_potentiellt_fororenade_omraden", rows: 1 },
  { table: "env.protected_area", rows: 2 },
];

const LATENCY = [
  {
    query: "property_unit lookup",
    p50: 2.14,
    p95: 2.94,
    p99: 3.73,
    exec: 0.092,
    plan: 0.19,
    scan: "Index (btree designation_norm)",
    gist: false,
    rows: 1,
    hit: 5,
    read: 0,
  },
  {
    query: "water ST_DWithin",
    p50: 1.6,
    p95: 2.32,
    p99: 2.6,
    exec: 0.039,
    plan: 0.077,
    scan: "Seq Scan",
    gist: false,
    rows: 1,
    hit: 2,
    read: 0,
  },
  {
    query: "ebh ST_DWithin",
    p50: 1.85,
    p95: 2.29,
    p99: 2.57,
    exec: 0.042,
    plan: 0.089,
    scan: "Seq Scan",
    gist: false,
    rows: 1,
    hit: 2,
    read: 0,
  },
  {
    query: "protected_area ST_DWithin",
    p50: 1.53,
    p95: 2.05,
    p99: 2.34,
    exec: 0.031,
    plan: 0.059,
    scan: "Seq Scan",
    gist: false,
    rows: 1,
    hit: 2,
    read: 0,
  },
];

/**
 * Repo-archived copy of the Cursor canvas for baseline documentation.
 * Live IDE canvas: ~/.cursor/projects/.../canvases/spatial-magic-moment-benchmark.canvas.tsx
 */
export default function SpatialMagicMomentBenchmark() {
  return (
    <Stack gap={24} style={{ padding: 24, maxWidth: 1100 }}>
      <Stack gap={8}>
        <Row gap={12} style={{ alignItems: "center" }}>
          <H1>Spatial Magic Moment — benchmark baseline</H1>
          <Pill tone="success">BASELINE ONLY</Pill>
        </Row>
        <Text tone="secondary">
          Magic Moment FROZEN / PROVEN ({BASELINE}) · riskguard_test · VÄSTERÅS 1:1 ·
          51 iterations · no optimization · {GENERATED_AT}
        </Text>
      </Stack>

      <Callout tone="info">
        Seq Scan is expected because test spatial tables contain only 1–2 rows.
        This benchmark does not establish production spatial performance. It does
        not mean PostGIS is optimized, and it does not mean missing GiST is a
        problem.
      </Callout>

      <Grid columns={4} gap={12}>
        <Stat value="< 4 ms" label="Worst client p99 (test DB)" />
        <Stat value="1–2" label="Rows per spatial table" />
        <Stat value="btree" label="property_unit lookup path" />
        <Stat value="Seq Scan" label="Spatial layers (expected)" />
      </Grid>

      <Divider />

      <H2>Client latency (ms)</H2>
      <Text tone="secondary" size="small">
        Source: node pg client hrtime against local PostGIS · p50/p95/p99 over 51
        runs
      </Text>
      <BarChart
        categories={LATENCY.map((q) => q.query)}
        series={[
          { name: "p50 (ms)", data: LATENCY.map((q) => q.p50) },
          { name: "p95 (ms)", data: LATENCY.map((q) => q.p95) },
          { name: "p99 (ms)", data: LATENCY.map((q) => q.p99) },
        ]}
        height={260}
      />

      <H2>EXPLAIN (ANALYZE, BUFFERS)</H2>
      <Table
        headers={[
          "Query",
          "Plan ms",
          "Exec ms",
          "Scan",
          "GiST used",
          "Rows",
          "shared hit",
          "shared read",
        ]}
        rows={LATENCY.map((q) => [
          q.query,
          q.plan.toFixed(3),
          q.exec.toFixed(3),
          q.scan,
          q.gist ? "yes" : "no",
          String(q.rows),
          String(q.hit),
          String(q.read),
        ])}
      />

      <Grid columns={2} gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="neutral">counts</Pill>}>
            Table cardinality
          </CardHeader>
          <CardBody>
            <Table
              headers={["Table", "Rows"]}
              rows={COUNTS.map((c) => [c.table, String(c.rows)])}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader trailing={<Pill tone="neutral">indexes</Pill>}>
            Index inventory (observation)
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>
                property_unit: btree (+ gin/trgm) on designation_norm — used for
                exact lookup.
              </Text>
              <Text>
                Spatial layers: primary key only in this test DB. Index strategy
                is deferred until a realistic-population re-bench.
              </Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H3>Freeze state</H3>
      <Stack gap={6}>
        <Text>Magic Moment — FROZEN / PROVEN ({BASELINE})</Text>
        <Text>Benchmark baseline — RECORDED (no optimization)</Text>
        <Text>PostGIS optimization — NO-GO until realistic spatial benchmark</Text>
        <Text tone="secondary" size="small">
          Artifact: docs/ops/benchmarks/spatial-magic-moment-latest.json · ADR:
          docs/architecture/ADR-SPATIAL-QUERY-CONTRACT.md
        </Text>
      </Stack>
    </Stack>
  );
}
