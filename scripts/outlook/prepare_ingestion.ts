import fs from 'node:fs';
import path from 'node:path';

function parseLine(line: string, delimiter: string = ';') {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"') {
            if (inQuotes && next === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (char === delimiter && !inQuotes) {
            result.push(current);
            current = "";
        } else { current += char; }
    }
    result.push(current);
    return result;
}

function parseCSV(content: string, delimiter: string = ';') {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];
    let headerLine = lines[0];
    if (headerLine.charCodeAt(0) === 0xFEFF) headerLine = headerLine.slice(1);
    const headers = parseLine(headerLine, delimiter).map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = parseLine(line, delimiter);
        const obj: any = {};
        headers.forEach((h, i) => { if (h) obj[h] = values[i] || ""; });
        return obj;
    });
}

const baseDir = 'C:\\Users\\jimmy\\Desktop\\OutlookExport';
const p3Path = path.join(baseDir, 'outlook_backlog_p3_material_mottaget.csv');
const manifestPath = path.join(baseDir, 'manifest.csv');
const p1Path = path.join(baseDir, 'outlook_backlog_p1_akut.csv');

console.log("Loading P3 and P1 lists...");
const p3Rows = parseCSV(fs.readFileSync(p3Path, 'utf8'), ';');
const p1Rows = parseCSV(fs.readFileSync(p1Path, 'utf8'), ';');
const p3Ids = new Set(p3Rows.map(r => r.EntryID));
const p1Ids = new Set(p1Rows.map(r => r.EntryID));

console.log("Loading manifest...");
const manifestRows = parseCSV(fs.readFileSync(manifestPath, 'utf8'), ';');

const toIngest = manifestRows.filter(m => p3Ids.has(m.message_id) || p1Ids.has(m.message_id));

console.log(`Found ${toIngest.length} attachments for P3 and P1 items.`);

// Write to a temporary manifest for ingestion
const headers = Object.keys(toIngest[0]);
const output = [
    headers.join(';'),
    ...toIngest.map(row => headers.map(h => `"${String(row[h]).replace(/"/g, '""')}"`).join(';'))
].join('\n');

const outputPath = path.join(baseDir, 'ingest_backlog_manifest.csv');
fs.writeFileSync(outputPath, '\ufeff' + output, 'utf8');
console.log(`Created ${outputPath}`);
