import pkg from 'pg';
import dotenv from 'dotenv';
const { Client } = pkg;

dotenv.config();

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();
    
    // Get column names
    const resCols = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'env' AND table_name = 'sgu_soil_type'
    `);
    const cols = resCols.rows.map(r => r.column_name);
    console.log('Columns:', cols.join(', '));
    
    // Try to find a text column for description
    const textCol = cols.find(c => c.includes('_tx') || c === 'lf' || c === 'sp') || 'ogc_fid';
    
    const res = await client.query(`
        SELECT count(*), ${textCol} as label
        FROM env.sgu_soil_type 
        GROUP BY ${textCol} 
        ORDER BY count DESC 
        LIMIT 10
    `);
    
    console.log('\n--- DATA EXEMPEL ---');
    res.rows.forEach(row => {
        console.log(`${row.label}: ${row.count} rader`);
    });
    
    await client.end();
}

run().catch(console.error);
