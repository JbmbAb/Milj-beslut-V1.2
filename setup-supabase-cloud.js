/**
 * setup-supabase-cloud.js
 * Används för att provisionera en ny Supabase Cloud-databas.
 * 1. Aktiverar Extensions (PostGIS, Vector, pg_trgm, unaccent)
 * 2. Skapar scheman (env, core)
 * 3. Kör spatial-migrations (SGU-tabeller)
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Enkel env-laddare
function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return {};
    return Object.fromEntries(
        fs.readFileSync(envPath, 'utf-8')
            .split(/\r?\n/)
            .filter(l => l.includes('=') && !l.startsWith('#'))
            .map(l => {
                const i = l.indexOf('=');
                return [l.slice(0, i).trim(), l.slice(i+1).trim()];
            })
    );
}

async function main() {
    const env = loadEnv();
    const DATABASE_URL = env.DATABASE_URL;

    if (!DATABASE_URL || !DATABASE_URL.includes('supabase.com')) {
        console.error('❌ DATABASE_URL saknas eller är inte en Supabase-adress i .env');
        console.log('Klistra in din Supabase URI (port 6543) i .env först!');
        process.exit(1);
    }

    console.log(`🚀 Ansluter till Supabase: ${DATABASE_URL.split('@')[1]}`);

    const client = new pg.Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Krävs för Supabase Cloud
    });

    try {
        const poolClient = await client.connect();
        console.log('✅ Ansluten!\n');

        // 1. Extensions
        console.log('📦 Aktiverar Extensions...');
        const extensions = ['postgis', 'vector', 'pg_trgm', 'unaccent'];
        for (const ext of extensions) {
            try {
                await poolClient.query(`CREATE EXTENSION IF NOT EXISTS "${ext}" CASCADE;`);
                console.log(`   ✅ ${ext}`);
            } catch (e) {
                console.warn(`   ⚠️  Kunde inte installera ${ext}: ${e.message}`);
            }
        }

        // 2. Scheman
        console.log('\n🏗️  Skapar scheman...');
        await poolClient.query('CREATE SCHEMA IF NOT EXISTS env;');
        await poolClient.query('CREATE SCHEMA IF NOT EXISTS core;');
        console.log('   ✅ env, core');

        // 3. Spatial Migrations
        const spatialFile = path.join(__dirname, 'prisma', 'migrations', 'spatial', '001_env_spatial_tables.sql');
        if (fs.existsSync(spatialFile)) {
            console.log('\n🗺️  Kör SGU Spatial Migrations...');
            const sql = fs.readFileSync(spatialFile, 'utf-8');
            try {
                await poolClient.query(sql);
                console.log('   ✅ Spatialtabeller skapade.');
            } catch (e) {
                if (e.message.includes('already exists')) {
                    console.log('   ℹ️  Spatialtabeller finns redan.');
                } else {
                    throw e;
                }
            }
        }

        poolClient.release();
        console.log('\n✨ Supabase Cloud är nu redo för Miljöbeslut.se!');
        console.log('Kör nu: npx prisma migrate deploy');
        
    } catch (err) {
        console.error('\n❌ ETT FEL UPPSTOD:', err.message);
    } finally {
        await client.end();
    }
}

main();
