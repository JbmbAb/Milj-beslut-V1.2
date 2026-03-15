import fs from 'fs';

async function main() {
    const csvContent = fs.readFileSync('kravmatris_mellanlagring_autofylld.csv', 'utf8');
    const lines = csvContent.split('\n');
    const header = lines[0].split(';');
    const rows = lines.slice(1).filter(l => l.trim() !== '');

    console.log(`Total Rows in CSV (Kravrader): ${rows.length}`);

    const kommunIdx = header.indexOf('Kommun');
    const munis = new Set();
    const caseIds = new Set();

    const typeIdx = header.indexOf('Myndighetstyp');
    for (const row of lines.slice(1)) {
        const cells = row.split(';');
        const muni = cells[kommunIdx]?.trim();
        const type = cells[typeIdx]?.trim();
        if (muni && muni !== '' && !muni.includes('Okänd') && !muni.includes('OkÃ¤nd') && type === 'Kommun') {
            munis.add(muni);
        }
        if (cells[0] && cells[0] !== '') {
            caseIds.add(cells[0].trim());
        }
    }

    console.log(`Unique Municipalities (CSV): ${munis.size}`);
    console.log(`Unique Case IDs (CSV): ${caseIds.size}`);
}

main();
