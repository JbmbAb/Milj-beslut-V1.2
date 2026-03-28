import fs from 'node:fs';
import path from 'node:path';

// Robust semicsv parser (same as in ai_backlog_analyzer)
function parseSemicolonCSV(content: string): any[] {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];
    let headerLine = lines[0];
    if (headerLine.charCodeAt(0) === 0xFEFF) headerLine = headerLine.slice(1);

    const parseLine = (line: string) => {
        const result = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const next = line[i + 1];
            if (char === '"') {
                if (inQuotes && next === '"') { current += '"'; i++; }
                else { inQuotes = !inQuotes; }
            } else if (char === ';' && !inQuotes) {
                result.push(current);
                current = "";
            } else { current += char; }
        }
        result.push(current);
        return result;
    };

    const headers = parseLine(headerLine).map(h => h.trim());
    return lines.slice(1).map(line => {
        const values = parseLine(line);
        const obj: any = {};
        headers.forEach((h, i) => { if (h) obj[h] = values[i] || ""; });
        return obj;
    });
}

function toSemicolonCSV(rows: any[]): string {
    if (rows.length === 0) return "";
    const headers = Object.keys(rows[0]);
    const headerLine = headers.map(h => `"${h}"`).join(';');
    const dataLines = rows.map(row =>
        headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(';')
    );
    return [headerLine, ...dataLines].join('\n');
}

async function main() {
    const baseDir = 'C:\\Users\\jimmy\\Desktop\\OutlookExport';
    const mainTriagePath = path.join(baseDir, 'outlook_backlog_operativ_sortering.csv');
    const aiAnalysisPath = path.join(baseDir, 'outlook_backlog_ai_deep_analysis.csv');

    console.log("Reading existing triage and AI analysis...");

    // Read files
    const mainRows = parseSemicolonCSV(fs.readFileSync(mainTriagePath, 'utf8'));
    const aiRows = parseSemicolonCSV(fs.readFileSync(aiAnalysisPath, 'utf8'));

    // Map AI findings by EntryID
    const aiMap = new Map();
    for (const air of aiRows) {
        aiMap.set(air.EntryID, air);
    }

    console.log(`Merging ${aiRows.length} AI results into original list...`);

    let reclassifiedCount = 0;
    const mergedRows = mainRows.map(row => {
        const aiMatch = aiMap.get(row.EntryID);
        if (aiMatch && aiMatch.AiBucket && aiMatch.AiBucket !== row.OperationalBucket) {
            reclassifiedCount++;
            return {
                ...row,
                OperationalBucket: aiMatch.AiBucket,
                OperationalReason: `AI_RECLASSIFIED: ${aiMatch.AiReasoning}`,
                DraftResponse: aiMatch.AiDraft || row.DraftResponse
            };
        }
        return row;
    });

    console.log(`Updated ${reclassifiedCount} rows based on AI/OCR deep scan.`);

    // Write back the main file
    fs.writeFileSync(mainTriagePath, '\ufeff' + toSemicolonCSV(mergedRows), 'utf8');

    // Re-split into P1-P5 files
    const buckets: Record<string, any[]> = {};
    mergedRows.forEach(row => {
        const b = row.OperationalBucket || "P5-Avvikande";
        if (!buckets[b]) buckets[b] = [];
        buckets[b].push(row);
    });

    console.log("Writing updated bucket files...");
    const fileMap: Record<string, string> = {
        "P1-Akut": "outlook_backlog_p1_akut.csv",
        "P2-Handlaggardialog": "outlook_backlog_p2_handlaggardialog.csv",
        "P3-MaterialMottaget": "outlook_backlog_p3_material_mottaget.csv",
        "P4-HanvisningEllerIngaArenden": "outlook_backlog_p4_hanvisning_inga_arenden.csv",
        "P5-Avvikande": "outlook_backlog_p5_avvikande.csv"
    };

    for (const [bucket, filename] of Object.entries(fileMap)) {
        const rows = buckets[bucket] || [];
        fs.writeFileSync(path.join(baseDir, filename), '\ufeff' + toSemicolonCSV(rows), 'utf8');
        console.log(` - ${filename}: ${rows.length} rows`);
    }

    console.log("Done!");
}

main().catch(console.error);
