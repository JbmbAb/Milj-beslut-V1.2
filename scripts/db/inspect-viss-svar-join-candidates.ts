import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

type CandidateTable = {
  table_schema: string;
  table_name: string;
  columns: string[];
  geom_column: string | null;
  row_count: number;
  eu_cd_matches: number | null;
  ms_cd_matches: number | null;
};

const CANDIDATE_SCHEMAS = ['hydro', 'env'];
const IDENTIFIER_COLUMNS = ['eu_cd', 'ms_cd', 'uuid', 'gml_id', 'aro_id', 'viss_id'];

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function qualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

async function getColumns(client: pg.Client, schema: string, table: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `,
    [schema, table],
  );
  return result.rows.map((row) => row.column_name);
}

async function getRowCount(client: pg.Client, schema: string, table: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(1) AS count FROM ${qualified(schema, table)};`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countMatches(
  client: pg.Client,
  schema: string,
  table: string,
  candidateColumn: 'eu_cd' | 'ms_cd',
): Promise<number | null> {
  const columns = await getColumns(client, schema, table);
  if (!columns.includes(candidateColumn)) return null;

  const result = await client.query<{ count: string }>(`
    SELECT count(1) AS count
    FROM env.viss_status_cycle_3 v
    JOIN ${qualified(schema, table)} s
      ON v.${candidateColumn} = s.${quoteIdent(candidateColumn)}
    WHERE s.geom IS NOT NULL;
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL saknas i .env');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const tables = await client.query<{
      table_schema: string;
      table_name: string;
      geom_column: string | null;
    }>(
      `
        SELECT c.table_schema, c.table_name, max(CASE WHEN c.column_name = 'geom' THEN c.column_name END) AS geom_column
        FROM information_schema.columns c
        WHERE c.table_schema = ANY($1)
        GROUP BY c.table_schema, c.table_name
        HAVING bool_or(c.column_name = 'geom')
        ORDER BY c.table_schema, c.table_name;
      `,
      [CANDIDATE_SCHEMAS],
    );

    const candidates: CandidateTable[] = [];
    for (const table of tables.rows) {
      const columns = await getColumns(client, table.table_schema, table.table_name);
      const interestingColumns = columns.filter((column) =>
        IDENTIFIER_COLUMNS.includes(column.toLowerCase()),
      );
      if (interestingColumns.length === 0 && table.table_schema !== 'hydro') continue;

      candidates.push({
        table_schema: table.table_schema,
        table_name: table.table_name,
        columns: interestingColumns,
        geom_column: table.geom_column,
        row_count: await getRowCount(client, table.table_schema, table.table_name),
        eu_cd_matches: await countMatches(client, table.table_schema, table.table_name, 'eu_cd'),
        ms_cd_matches: await countMatches(client, table.table_schema, table.table_name, 'ms_cd'),
      });
    }

    console.log(JSON.stringify(candidates, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
