import pkg from 'pg';
import dotenv from 'dotenv';
const { Client } = pkg;

dotenv.config();

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });
    await client.connect();
    
    const res = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'env' AND table_name = 'sgu_soil_type'
    `);
    
    console.log('Columns:', res.rows.map(r => r.column_name).join(', '));
    await client.end();
}

run().catch(console.error);
