const { Client } = require('pg');
async function run() {
    const c = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');
    await c.connect();
    try {
        const idx = await c.query("SELECT count(*) FROM pg_indexes WHERE indexdef ILIKE '%gist%geom%'");
        console.log('GIST index count:', idx.rows[0].count);
        
        const lst = await c.query("SELECT relname FROM pg_class WHERE relkind='r' AND (relname ILIKE '%lansstyrelse%' OR relname ILIKE '%lst%')");
        console.log('Länsstyrelsen tables:', lst.rows.map(r=>r.relname));

        // Let's also check for specific datasets the user might associate with Länsstyrelsen
        const extra = await c.query("SELECT relname FROM pg_class WHERE relkind='r' AND (relname ILIKE '%vattenskydd%' OR relname ILIKE '%naturreservat%' OR relname ILIKE '%kulturmiljo%')");
        console.log('LST related topics:', extra.rows.map(r=>r.relname));
    } finally {
        await c.end();
    }
}
run();
