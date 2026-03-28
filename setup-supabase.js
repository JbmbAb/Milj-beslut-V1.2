/**
 * setup-supabase.js
 * Kopplar upp mot Supabase (eller lokal DB) och kör alla nödvändiga SQL-migreringar.
 *
 * Kör med: node setup-supabase.js
 *
 * Kräver att DATABASE_URL är satt i .env
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ladda .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL saknas i .env!');
    process.exit(1);
}

// Visa vilken databas vi kopplar mot (dölj lösenordet)
const displayUrl = DATABASE_URL.replace(/:([^:@]+)@/, ':***@');
console.log(`\n🔌 Ansluter till: ${displayUrl}\n`);

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('supabase.com') ? { rejectUnauthorized: false } : false });

async function run() {
    await client.connect();
    console.log('✅ Anslutning OK!\n');

    // ─── 1. Extensions ─────────────────────────────────────────
    console.log('📦 Aktiverar extensions...');
    const extensions = [
        { name: 'postgis',          sql: 'CREATE EXTENSION IF NOT EXISTS postgis;' },
        { name: 'postgis_topology', sql: 'CREATE EXTENSION IF NOT EXISTS postgis_topology;' },
        { name: 'vector',           sql: 'CREATE EXTENSION IF NOT EXISTS vector;' },
        { name: 'pg_trgm',          sql: 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' },
        { name: 'unaccent',         sql: 'CREATE EXTENSION IF NOT EXISTS unaccent;' },
    ];

    for (const ext of extensions) {
        try {
            await client.query(ext.sql);
            console.log(`   ✅ ${ext.name}`);
        } catch (e) {
            console.log(`   ⚠️  ${ext.name}: ${e.message}`);
        }
    }

    // ─── 2. Scheman ─────────────────────────────────────────────
    console.log('\n🏗️  Skapar scheman...');
    try {
        await client.query(`
            CREATE SCHEMA IF NOT EXISTS env;
            CREATE SCHEMA IF NOT EXISTS core;
        `);
        // Ge rättigheter om möjligt (hoppa om Supabase nekar)
        const user = DATABASE_URL.match(/\/\/([^:]+):/)?.[1] || 'postgres';
        await client.query(`
            GRANT ALL PRIVILEGES ON SCHEMA env TO ${user};
            GRANT ALL PRIVILEGES ON SCHEMA core TO ${user};
        `).catch(() => {});
        console.log('   ✅ env + core scheman OK');
    } catch (e) {
        console.log(`   ⚠️  Scheman: ${e.message}`);
    }

    // ─── 3. Kontroll av init-search.sql ─────────────────────────
    const initSql = path.join(__dirname, 'scripts', 'db', 'init-search.sql');
    if (fs.existsSync(initSql)) {
        console.log('\n🔍 Kör init-search.sql...');
        try {
            const sql = fs.readFileSync(initSql, 'utf-8');
            await client.query(sql);
            console.log('   ✅ init-search.sql klar');
        } catch (e) {
            console.log(`   ⚠️  init-search.sql: ${e.message}`);
        }
    }

    // ─── 4. Spatial-migrationer (SGU) ───────────────────────────
    const spatialDir = path.join(__dirname, 'prisma', 'migrations', 'spatial');
    if (fs.existsSync(spatialDir)) {
        console.log('\n🗺️  Kör spatial-migrationer (SGU)...');
        const files = fs.readdirSync(spatialDir).filter(f => f.endsWith('.sql')).sort();
        for (const file of files) {
            const filePath = path.join(spatialDir, file);
            const sql = fs.readFileSync(filePath, 'utf-8');
            try {
                await client.query(sql);
                console.log(`   ✅ ${file}`);
            } catch (e) {
                if (e.message.includes('already exists')) {
                    console.log(`   ℹ️  ${file}: redan installerat`);
                } else {
                    console.log(`   ⚠️  ${file}: ${e.message}`);
                }
            }
        }
    }

    // ─── 5. Verifiering ─────────────────────────────────────────
    console.log('\n🔎 Verifiering av databas-status...');
    const extResult = await client.query(`
        SELECT extname FROM pg_extension
        WHERE extname IN ('postgis', 'vector', 'pg_trgm', 'unaccent')
        ORDER BY extname;
    `);
    console.log('   Extensions installerade:');
    for (const row of extResult.rows) {
        console.log(`      ✅ ${row.extname}`);
    }

    const schemaResult = await client.query(`
        SELECT schema_name FROM information_schema.schemata
        WHERE schema_name IN ('env', 'core', 'public')
        ORDER BY schema_name;
    `);
    console.log('   Scheman:');
    for (const row of schemaResult.rows) {
        console.log(`      ✅ ${row.schema_name}`);
    }

    const tableResult = await client.query(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema = 'env'
        ORDER BY table_name;
    `);
    if (tableResult.rows.length > 0) {
        console.log('   env-tabeller:');
        for (const row of tableResult.rows) {
            console.log(`      ✅ env.${row.table_name}`);
        }
    } else {
        console.log('   ℹ️  Inga env-tabeller hittas ännu (kör Prisma migrate för det)');
    }

    await client.end();

    console.log('\n══════════════════════════════════════════════');
    console.log('  ✅ Databas-setup klar!');
    console.log('');
    console.log('  Nästa steg:');
    console.log('  1. Kör: npx prisma migrate deploy');
    console.log('  2. Starta: npm run dev:server');
    console.log('══════════════════════════════════════════════\n');
}

run().catch(err => {
    console.error('\n❌ Fel:', err.message);
    client.end().catch(() => {});
    process.exit(1);
});
