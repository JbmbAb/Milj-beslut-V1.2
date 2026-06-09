const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const c = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');
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
        
        let md = `# Databasinventering - Mimer Miljöintelligens\n\n`;
        md += `**Totalt antal polygoner/geometrier:** ${Math.round(total).toLocaleString('sv-SE')}\n`;
        md += `**Antal tabeller:** ${rows.length}\n\n`;
        
        md += `| Tabellnamn | Antal Rader |\n`;
        md += `|---|---|\n`;
        
        rows.forEach(r => {
            md += `| \`${r.table_name}\` | ${Math.round(r.row_count).toLocaleString('sv-SE')} |\n`;
        });
        
        fs.writeFileSync('C:/Users/jimmy/.gemini/antigravity/brain/84c89746-caa6-4675-a15c-9c46cbf312b0/geodata_inventory.md', md);
        console.log('Artifact skapad!');
    } catch(e) {
        console.error(e);
    } finally {
        await c.end();
    }
}
run();
