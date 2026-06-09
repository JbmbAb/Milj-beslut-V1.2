const { Client } = require('pg');
const c = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');

async function run() {
    await c.connect();
    try {
        const query = `
            SELECT relname as table_name, reltuples as row_count 
            FROM pg_class C 
            LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace) 
            WHERE nspname NOT IN ('pg_catalog', 'information_schema') AND relkind = 'r' 
            ORDER BY reltuples DESC;
        `;
        const res = await c.query(query);
        const rows = res.rows.filter(r => r.table_name.startsWith('geo_') || r.table_name.startsWith('topo_'));
        const total = rows.reduce((acc, val) => acc + Number(val.row_count), 0);
        
        console.log(`\n=== DATABAS-STATISTIK ===`);
        console.log(`Totalt antal polygoner/geometrier: ${Math.round(total).toLocaleString('sv-SE')}`);
        console.log(`\n--- Topp 15 Största Tabeller ---`);
        rows.slice(0, 15).forEach(r => {
            console.log(`${Math.round(r.row_count).toLocaleString('sv-SE').padStart(10, ' ')} rader | ${r.table_name}`);
        });
    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}
run();
