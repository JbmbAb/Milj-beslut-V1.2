
import { Pool } from 'pg';

async function main() {
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.error('DATABASE_URL is missing');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: connStr });
  try {
    const schemas = ['public', 'env', 'topo10', 'core'];
    console.log('Row counts per table:');
    console.log('---------------------');

    for (const schema of schemas) {
      const { rows: tables } = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
      `, [schema]);

      for (const table of tables) {
        const tableName = table.table_name;
        const { rows: countResult } = await pool.query(`SELECT COUNT(*) FROM "${schema}"."${tableName}"`);
        console.log(`${schema}.${tableName}: ${countResult[0].count}`);
      }
    }
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await pool.end();
  }
}

main();
