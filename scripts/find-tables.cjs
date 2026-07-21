const { Client } = require('pg');
async function run() {
    const c = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');
    await c.connect();
    try {
        const query = `
            SELECT relname as table_name, reltuples as row_count 
            FROM pg_class C 
            LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace) 
            WHERE (relname ILIKE '%jordart%' OR relname ILIKE '%fastighet%' OR relname ILIKE '%mark%')
              AND relkind = 'r'
            ORDER BY reltuples DESC;
        `;
        const res = await c.query(query);
        console.log("Tabeller som matchar 'jordart', 'fastighet' eller 'mark':");
        res.rows.forEach(r => console.log(`${r.table_name}: ${Math.round(r.row_count)} rader`));
    } finally {
        await c.end();
    }
}
run();
