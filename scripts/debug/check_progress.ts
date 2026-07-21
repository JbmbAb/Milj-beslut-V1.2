import pkg from 'pg';
import dotenv from 'dotenv';
const { Client } = pkg;

dotenv.config();

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();
    
    console.log('--- JORDARTER STATUS ---');
    const resCount = await client.query('SELECT count(*) FROM env.sgu_soil_type');
    console.log('Totalt antal rader:', resCount.rows[0].count);
    
    console.log('\n--- TOPP 5 JORDARTER I DATABASEN JUST NU ---');
    const resTypes = await client.query(`
        SELECT lf_tx, count(*) 
        FROM env.sgu_soil_type 
        WHERE lf_tx IS NOT NULL 
        GROUP BY lf_tx 
        ORDER BY count DESC 
        LIMIT 5
    `);
    
    resTypes.rows.forEach(row => {
        console.log(`${row.lf_tx}: ${row.count} polygoner`);
    });
    
    await client.end();
}

run().catch(console.error);
