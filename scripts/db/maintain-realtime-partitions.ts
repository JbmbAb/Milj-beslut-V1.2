#!/usr/bin/env tsx
/**
 * Creates future monthly partitions for realtime/audit partitioned tables.
 *
 * Dry-run by default.
 *
 * Examples:
 *   npm run db:partition:maintain
 *   npm run db:partition:maintain -- --apply --months-forward=24
 */
import { Client } from 'pg';

type TableSpec = {
  table: string;
  partitionColumn: string;
};

const TABLES: TableSpec[] = [
  { table: 'GpsPosition', partitionColumn: 'timestamp' },
  { table: 'AuditTrail', partitionColumn: 'timestamp' },
  { table: 'SearchQueryLog', partitionColumn: 'createdAt' },
  { table: 'PropertyAccessLog', partitionColumn: 'timestamp' },
];

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseArgs(argv: string[]): { apply: boolean; monthsBack: number; monthsForward: number; help: boolean } {
  let apply = false;
  let monthsBack = 0;
  let monthsForward = 18;
  let help = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg.startsWith('--months-back=')) {
      monthsBack = parsePositiveInt(arg, '--months-back=');
      continue;
    }

    if (arg.startsWith('--months-forward=')) {
      monthsForward = parsePositiveInt(arg, '--months-forward=');
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply, monthsBack, monthsForward, help };
}

function parsePositiveInt(arg: string, prefix: string): number {
  const value = Number(arg.slice(prefix.length));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${prefix}${value}`);
  }
  return value;
}

function firstOfMonth(offsetMonths: number): Date {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() + offsetMonths);
  return date;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

function partitionName(table: string, monthStart: Date): string {
  const year = monthStart.getUTCFullYear();
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, '0');
  return `${table}_${year}_${month}`;
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

async function isRangePartitioned(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query<{ is_partitioned: boolean }>(
    `
      SELECT pt.partstrat = 'r' AS is_partitioned
      FROM pg_class cls
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      JOIN pg_partitioned_table pt ON pt.partrelid = cls.oid
      WHERE ns.nspname = 'public'
        AND cls.relname = $1
    `,
    [table],
  );
  return Boolean(rows[0]?.is_partitioned);
}

async function createPartitions(
  client: Client,
  spec: TableSpec,
  monthsBack: number,
  monthsForward: number,
  apply: boolean,
): Promise<void> {
  if (!(await isRangePartitioned(client, spec.table))) {
    console.log(`[SKIP] public.${spec.table} is not a range-partitioned table.`);
    return;
  }

  for (let offset = -monthsBack; offset <= monthsForward; offset++) {
    const start = firstOfMonth(offset);
    const end = firstOfMonth(offset + 1);
    const childName = partitionName(spec.table, start);

    if (await tableExists(client, 'public', childName)) {
      console.log(`[OK] public.${childName} already exists.`);
      continue;
    }

    const sql =
      `CREATE TABLE public.${quoteIdent(childName)} ` +
      `PARTITION OF public.${quoteIdent(spec.table)} ` +
      `FOR VALUES FROM ('${formatDate(start)}') TO ('${formatDate(end)}')`;

    if (!apply) {
      console.log(`[DRY RUN] ${sql};`);
      continue;
    }

    await client.query(sql);
    console.log(`[CREATED] public.${childName}`);
  }
}

async function main(): Promise<void> {
  const { apply, monthsBack, monthsForward, help } = parseArgs(process.argv.slice(2));

  if (help) {
    console.log('Usage: tsx scripts/db/maintain-realtime-partitions.ts [--apply] [--months-back=N] [--months-forward=N]');
    console.log('Creates missing monthly partitions for realtime/audit partitioned tables.');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL saknas.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    for (const spec of TABLES) {
      await createPartitions(client, spec, monthsBack, monthsForward, apply);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('maintain-realtime-partitions failed:', error);
  process.exit(1);
});
