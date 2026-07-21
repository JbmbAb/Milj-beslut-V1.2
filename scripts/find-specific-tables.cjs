const { Client } = require('pg');

async function run() {
    const c = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');
    await c.connect();
    try {
        const query = `
            SELECT relname as table_name, reltuples as row_count 
            FROM pg_class C 
            LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace) 
            WHERE relkind = 'r' 
              AND nspname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY relname ASC;
        `;
        const res = await c.query(query);
        const rows = res.rows;
        
        const categories = {
            'Vatten & Hydro (SVAR, VISS, Hav&Vatten)': ['vatten', 'hydro', 'svar', 'viss', 'hav_och_vatten', 'avrinningsomrade'],
            'Brunnar & Grundvatten (SGU)': ['brunn', 'grundvatten', 'vattentakt'],
            'MSB (Översvämning m.m.)': ['msb', 'oversvamning'],
            'SGI (Geoteknik)': ['sgi', 'skred', 'ras'],
            'SGU (Geologi)': ['sgu', 'jordart', 'berggrund', 'malm', 'mineral'],
            'SLU (Skog & Mark)': ['slu', 'skog', 'marktacke'],
            'Topo (10, 50, 250, 1M)': ['topo10', 'topo50', 'topo250', 'topo1', 'topo_']
        };

        for (const [category, keywords] of Object.entries(categories)) {
            console.log(`\n=== ${category} ===`);
            const matched = rows.filter(r => keywords.some(k => r.table_name.toLowerCase().includes(k)));
            if (matched.length === 0) {
                console.log("  (Inga tabeller hittades med dessa nyckelord)");
            } else {
                matched.forEach(r => console.log(`  ${r.table_name}: ${Math.round(r.row_count).toLocaleString('sv-SE')} rader`));
            }
        }
    } finally {
        await c.end();
    }
}
run();
