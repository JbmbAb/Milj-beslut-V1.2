#!/usr/bin/env tsx
/**
 * Verifies range partitioning for high-growth realtime/audit tables.
 *
 * Examples:
 *   npm run db:partition:verify
 *   tsx scripts/db/verify-realtime-partitions.ts --strict
 */
import { Client } from 'pg';

type TableSpec = {
  table: string;
  partitionColumn: string;
  expectedIndexes: string[];
  expectedTriggers?: string[];
  expectedRegistryTables?: string[];
};

type CheckResult = {
  ok: boolean;
  label: string;
  details?: string;
};

const TABLES: TableSpec[] = [
  {
    table: 'GpsPosition',
    partitionColumn: 'timestamp',
    expectedIndexes: ['GpsPosition_bookingId_timestamp_idx', 'GpsPosition_timestamp_brin_idx'],
    expectedTriggers: ['GpsPosition_unique_id_registry'],
    expectedRegistryTables: ['GpsPosition_id_registry'],
  },
  {
    table: 'AuditTrail',
    partitionColumn: 'timestamp',
    expectedIndexes: [
      'AuditTrail_entityType_timestamp_idx',
      'AuditTrail_reference_number_idx',
      'AuditTrail_timestamp_brin_idx',
    ],
    expectedTriggers: ['AuditTrail_unique_registry'],
    expectedRegistryTables: ['AuditTrail_id_registry', 'AuditTrail_chainHash_registry'],
  },
  {
    table: 'SearchQueryLog',
    partitionColumn: 'createdAt',
    expectedIndexes: [
      'SearchQueryLog_projectId_createdAt_idx',
      'SearchQueryLog_userId_createdAt_idx',
      'SearchQueryLog_createdAt_brin_idx',
    ],
  },
  {
    table: 'PropertyAccessLog',
    partitionColumn: 'timestamp',
    expectedIndexes: [
      'PropertyAccessLog_projectId_timestamp_idx',
      'PropertyAccessLog_userId_timestamp_idx',
      'PropertyAccessLog_timestamp_brin_idx',
    ],
  },
];

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseArgs(argv: string[]): { strict: boolean; help: boolean } {
  return {
    strict: argv.includes('--strict'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function monthNames(monthsForward: number): string[] {
  const names: string[] = [];
  const cursor = new Date();
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i <= monthsForward; i++) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    names.push(`${year}_${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return names;
}

async function tableExists(client: Client, schema: string, table: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_class cls
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = $1
          AND cls.relname = $2
      ) AS exists
    `,
    [schema, table],
  );
  return Boolean(rows[0]?.exists);
}

async function checkPartitionedParent(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const { rows } = await client.query<{
    strategy: string | null;
    partition_key: string | null;
    partition_count: string;
  }>(
    `
      SELECT
        pt.partstrat::text AS strategy,
        pg_get_partkeydef(parent.oid) AS partition_key,
        count(child.oid)::text AS partition_count
      FROM pg_class parent
      JOIN pg_namespace ns ON ns.oid = parent.relnamespace
      LEFT JOIN pg_partitioned_table pt ON pt.partrelid = parent.oid
      LEFT JOIN pg_inherits inh ON inh.inhparent = parent.oid
      LEFT JOIN pg_class child ON child.oid = inh.inhrelid
      WHERE ns.nspname = 'public'
        AND parent.relname = $1
      GROUP BY pt.partstrat, parent.oid
    `,
    [spec.table],
  );

  const row = rows[0];
  const partitionKey = row?.partition_key || '';
  results.push({
    ok: row?.strategy === 'r',
    label: `${spec.table} is range-partitioned`,
    details: row ? `key=${partitionKey}, partitions=${row.partition_count}` : 'table missing',
  });
  results.push({
    ok: partitionKey.includes(quoteIdent(spec.partitionColumn)),
    label: `${spec.table} partition key is ${spec.partitionColumn}`,
    details: partitionKey || 'partition key missing',
  });

  return results;
}

async function checkIndexes(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  const { rows } = await client.query<{ indexname: string; indexdef: string }>(
    `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = $1
    `,
    [spec.table],
  );
  const byName = new Map(rows.map((row) => [row.indexname, row.indexdef]));

  return spec.expectedIndexes.map((indexName) => ({
    ok: byName.has(indexName),
    label: `${spec.table} index ${indexName}`,
    details: byName.get(indexName),
  }));
}

async function checkTriggers(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  if (!spec.expectedTriggers?.length) return [];

  const { rows } = await client.query<{ tgname: string }>(
    `
      SELECT tg.tgname
      FROM pg_trigger tg
      JOIN pg_class cls ON cls.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      WHERE ns.nspname = 'public'
        AND cls.relname = $1
        AND NOT tg.tgisinternal
    `,
    [spec.table],
  );
  const names = new Set(rows.map((row) => row.tgname));

  return spec.expectedTriggers.map((triggerName) => ({
    ok: names.has(triggerName),
    label: `${spec.table} trigger ${triggerName}`,
  }));
}

async function checkRegistryTables(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  if (!spec.expectedRegistryTables?.length) return [];

  const checks: CheckResult[] = [];
  for (const table of spec.expectedRegistryTables) {
    checks.push({
      ok: await tableExists(client, 'ops', table),
      label: `ops.${table} exists`,
    });
  }

  return checks;
}

async function checkLegacyCounts(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  const legacyName = `${spec.table}_legacy`;
  if (!(await tableExists(client, 'public', legacyName))) {
    return [{ ok: true, label: `${legacyName} absent or already retired` }];
  }

  const { rows } = await client.query<{ legacy_count: string; current_count: string }>(
    `
      SELECT
        (SELECT count(*) FROM public.${quoteIdent(legacyName)})::text AS legacy_count,
        (SELECT count(*) FROM public.${quoteIdent(spec.table)})::text AS current_count
    `,
  );
  const row = rows[0];
  return [
    {
      ok: row?.legacy_count === row?.current_count,
      label: `${spec.table} legacy/current row counts match`,
      details: `legacy=${row?.legacy_count ?? 'n/a'}, current=${row?.current_count ?? 'n/a'}`,
    },
  ];
}

async function checkDefaultPartition(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  const defaultName = `${spec.table}_default`;
  if (!(await tableExists(client, 'public', defaultName))) {
    return [{ ok: false, label: `${defaultName} exists`, details: 'default partition missing' }];
  }

  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM public.${quoteIdent(defaultName)}`,
  );
  const count = Number(rows[0]?.count ?? 0);
  return [
    {
      ok: count === 0,
      label: `${defaultName} is empty`,
      details: `${count} rows`,
    },
  ];
}

async function checkFuturePartitions(client: Client, spec: TableSpec): Promise<CheckResult[]> {
  const months = monthNames(3);
  const checks: CheckResult[] = [];
  for (const suffix of months) {
    const table = `${spec.table}_${suffix}`;
    checks.push({
      ok: await tableExists(client, 'public', table),
      label: `${table} exists`,
    });
  }

  return checks;
}

async function runChecks(client: Client): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const spec of TABLES) {
    results.push(...(await checkPartitionedParent(client, spec)));
    results.push(...(await checkIndexes(client, spec)));
    results.push(...(await checkTriggers(client, spec)));
    results.push(...(await checkRegistryTables(client, spec)));
    results.push(...(await checkLegacyCounts(client, spec)));
    results.push(...(await checkDefaultPartition(client, spec)));
    results.push(...(await checkFuturePartitions(client, spec)));
  }

  return results;
}

async function main(): Promise<void> {
  const { strict, help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log('Usage: tsx scripts/db/verify-realtime-partitions.ts [--strict]');
    console.log('Checks partition parents, indexes, registry triggers, row counts, and future partitions.');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL saknas.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const results = await runChecks(client);
    const failed = results.filter((result) => !result.ok);

    for (const result of results) {
      const prefix = result.ok ? '[OK]' : '[WARN]';
      console.log(`${prefix} ${result.label}${result.details ? ` (${result.details})` : ''}`);
    }

    if (failed.length > 0) {
      console.log(`\n${failed.length} partition checks need attention.`);
      if (strict) {
        process.exitCode = 1;
      }
    } else {
      console.log('\nAll realtime partition checks passed.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('verify-realtime-partitions failed:', error);
  process.exit(1);
});
