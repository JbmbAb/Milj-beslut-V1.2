import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function getColumns(schema, table) {
  const res = await client.query(`
    SELECT column_name, udt_name, is_nullable, column_default
    FROM information_schema.columns 
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position;
  `, [schema, table]);
  return res.rows;
}

async function run() {
  await client.connect();
  const tables = [
    { s: 'env', t: 'sgu_ground_layer' },
    { s: 'env', t: 'sgu_landslide_feature' },
    { s: 'env', t: 'natura2000_area' },
    { s: 'env', t: 'protected_area' }
  ];

  let sqlOutput = `-- Versioned Spatial Schema: env\n`;
  sqlOutput += `CREATE SCHEMA IF NOT EXISTS env;\n\n`;

  for (const { s, t } of tables) {
    const cols = await getColumns(s, t);
    sqlOutput += `-- ${s}.${t}\n`;
    sqlOutput += `CREATE TABLE IF NOT EXISTS ${s}.${t} (\n`;
    const colDef = cols.map(c => {
      let type = c.udt_name === 'varchar' ? 'varchar(255)' : c.udt_name;
      if (c.udt_name === 'geometry') type = 'geometry'; 
      return `  ${c.column_name} ${type}${c.is_nullable === 'NO' ? ' NOT NULL' : ''}${c.column_default ? ' DEFAULT ' + c.column_default : ''}`;
    });
    sqlOutput += colDef.join(',\n');
    sqlOutput += `\n);\n\n`;
    
    // Check for indexes
    const idx = await client.query(`
      SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2;
    `, [s, t]);
    idx.rows.forEach(r => {
      sqlOutput += `${r.indexdef};\n`;
    });
    sqlOutput += `\n`;
  }

  fs.writeFileSync('database_env_spatial.sql', sqlOutput);
  console.log('SQL generated to database_env_spatial.sql');
  await client.end();
}

run();
