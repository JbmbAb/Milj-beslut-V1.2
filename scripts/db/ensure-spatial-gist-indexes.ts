#!/usr/bin/env tsx
/**
 * Säkerställer GiST-index på stora geometry-tabeller som saknar sådant index.
 *
 * Standardbeteende:
 * - scheman: core, env, topo10, culture
 * - min rows: 10000
 * - dry-run om inte --apply skickas
 *
 * Exempel:
 *   npx tsx scripts/db/ensure-spatial-gist-indexes.ts
 *   npx tsx scripts/db/ensure-spatial-gist-indexes.ts --apply --min-rows=50000
 *   npx tsx scripts/db/ensure-spatial-gist-indexes.ts --apply --schemas=env,topo10
 */
import { createHash } from 'node:crypto';
import { Client } from 'pg';

type Candidate = {
  schemaname: string;
  tablename: string;
  geom_col: string;
  approx_rows: string | number;
};

const DEFAULT_SCHEMAS = ['core', 'env', 'topo10', 'culture'];
const DEFAULT_MIN_ROWS = 10_000;

function quoteIdent(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function makeIndexName(schema: string, table: string, column: string): string {
  const raw = `${schema}_${table}_${column}_gist_idx`
    .toLowerCase()
    .replaceAll(/[^a-z0-9_]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replaceAll(/^_|_$/g, '');

  if (raw.length <= 63) {
    return raw;
  }

  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${raw.slice(0, 54)}_${hash}`;
}

function parseArgs(argv: string[]): { apply: boolean; minRows: number; schemas: string[] } {
  let apply = false;
  let minRows = DEFAULT_MIN_ROWS;
  let schemas = DEFAULT_SCHEMAS;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg.startsWith('--min-rows=')) {
      const value = Number(arg.slice('--min-rows='.length));
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Ogiltigt --min-rows-värde: ${arg}`);
      }
      minRows = value;
      continue;
    }

    if (arg.startsWith('--schemas=')) {
      const value = arg
        .slice('--schemas='.length)
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

      if (value.length === 0) {
        throw new Error('Minst ett schema måste anges i --schemas.');
      }

      schemas = value;
    }
  }

  return { apply, minRows, schemas };
}

async function findCandidates(client: Client, schemas: string[], minRows: number): Promise<Candidate[]> {
  const { rows } = await client.query<Candidate>(
    `
      WITH spatial AS (
        SELECT
          n.nspname AS schemaname,
          c.relname AS tablename,
          a.attname AS geom_col,
          COALESCE(st.n_live_tup, 0)::bigint AS approx_rows
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        JOIN pg_type t ON t.oid = a.atttypid
        LEFT JOIN pg_stat_user_tables st
          ON st.schemaname = n.nspname
         AND st.relname = c.relname
        WHERE c.relkind = 'r'
          AND n.nspname = ANY($1::text[])
          AND a.attnum > 0
          AND NOT a.attisdropped
          AND t.typname = 'geometry'
      ),
      gist_geom AS (
        SELECT DISTINCT
          n.nspname AS schemaname,
          c.relname AS tablename,
          a.attname AS geom_col
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_index ix ON ix.indrelid = c.oid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON am.oid = i.relam
        JOIN pg_attribute a
          ON a.attrelid = c.oid
         AND a.attnum = ANY(ix.indkey)
        WHERE c.relkind = 'r'
          AND n.nspname = ANY($1::text[])
          AND am.amname = 'gist'
      )
      SELECT
        s.schemaname,
        s.tablename,
        s.geom_col,
        s.approx_rows
      FROM spatial s
      LEFT JOIN gist_geom g
        ON g.schemaname = s.schemaname
       AND g.tablename = s.tablename
       AND g.geom_col = s.geom_col
      WHERE g.tablename IS NULL
        AND s.approx_rows >= $2
      ORDER BY s.approx_rows DESC, s.schemaname, s.tablename
    `,
    [schemas, minRows],
  );

  return rows;
}

async function main(): Promise<void> {
  const { apply, minRows, schemas } = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL saknas.');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const candidates = await findCandidates(client, schemas, minRows);

    console.log(
      `Hittade ${candidates.length} geometry-tabeller utan GiST-index i [${schemas.join(', ')}], minRows=${minRows}.`,
    );

    if (candidates.length === 0) {
      return;
    }

    for (const candidate of candidates) {
      const approxRows = Number(candidate.approx_rows);
      const qualifiedTable = `${quoteIdent(candidate.schemaname)}.${quoteIdent(candidate.tablename)}`;
      const quotedColumn = quoteIdent(candidate.geom_col);
      const indexName = makeIndexName(candidate.schemaname, candidate.tablename, candidate.geom_col);
      const createIndexSql =
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${quoteIdent(indexName)} ` +
        `ON ${qualifiedTable} USING GIST (${quotedColumn})`;

      if (!apply) {
        console.log(
          `[DRY RUN] ${candidate.schemaname}.${candidate.tablename} (${candidate.geom_col}, ca ${approxRows} rader)`,
        );
        console.log(`          ${createIndexSql};`);
        continue;
      }

      const startedAt = Date.now();
      await client.query(createIndexSql);
      await client.query(`ANALYZE ${qualifiedTable}`);
      console.log(
        `[OK] ${candidate.schemaname}.${candidate.tablename} (${candidate.geom_col}, ca ${approxRows} rader) -> ${indexName} (${Date.now() - startedAt}ms)`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('ensure-spatial-gist-indexes fel:', error);
  process.exit(1);
});
