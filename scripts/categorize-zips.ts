import fs from 'fs';
import path from 'path';

const lines = fs.readFileSync('c:\\Dev\\miljobeslut-platform-recovery\\scripts\\all_zips.txt', 'utf16le').split('\n').map(l => l.trim()).filter(l => l.length > 0);

// If utf16le didn't work properly due to PS default encoding, fallback to utf8
let parsedLines = lines;
if (lines.length > 0 && lines[0].includes('\u0000')) {
    parsedLines = fs.readFileSync('c:\\Dev\\miljobeslut-platform-recovery\\scripts\\all_zips.txt', 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
}

const relevant: string[] = [];
const irrelevant: string[] = [];
const questionable: string[] = [];

const RELEVANT_TERMS = [
    'jordart', 'berggrund', 'grundvatten', 'geofysik', 'malmer', 'brunnar', 
    'strandforskjutning', 'klimat', 'miljogift', 'natura', 'vardetrakt', 'biogeokemi',
    'fastmark', 'jordskred', 'stranderosion', 'svaghetszoner', 'avrinningsomrade',
    'mineral', 'kallor', 'vatten', 'skydd', 'miljo'
];

const IRRELEVANT_TERMS = [
    'belaggning', 'beläggning', 'railway', 'trafikplats', 'road', 'cykel', 'topo', 
    'höjd', 'hojddata', 'satellit', 'scb', 'visualisering', 'atk_matplats'
];

for (const file of parsedLines) {
    const fLower = file.toLowerCase();
    
    let isIrrelevant = false;
    for (const term of IRRELEVANT_TERMS) {
        if (fLower.includes(term)) {
            isIrrelevant = true;
            break;
        }
    }
    if (isIrrelevant) {
        irrelevant.push(file);
        continue;
    }

    let isRelevant = false;
    for (const term of RELEVANT_TERMS) {
        if (fLower.includes(term)) {
            isRelevant = true;
            break;
        }
    }
    if (isRelevant) {
        relevant.push(file);
        continue;
    }

    // Default to questionable
    questionable.push(file);
}

// Write the result to a markdown artifact
let md = `# Geodata Categorization Review\n\n`;
md += `Enligt dina instruktioner har jag delat upp de 866 ZIP-filerna i tre kategorier baserat på relevans för miljötillsyn, tillstånd och geoteknik.\n\n`;

md += `## ❓ Tveksamma / Frågetecken (Behöver din granskning)\n`;
md += `Dessa filer har otydliga namn. Ofta rör det sig om filer namngivna efter kommuner (t.ex. \`stockholm-2022.zip\`), som kan innehålla avvattningsdata men lika gärna kommunala trafikplaner. Ska de importeras?\n\n`;
md += '```text\n';
md += questionable.join('\n');
md += '\n```\n\n';

md += `## ✅ Relevant (Kommer importeras)\n`;
md += `Dessa filer bedöms direkt relevanta för svensk miljöjuridik och geoteknik (innehåller nyckelord som jordarter, grundvatten, berggrund, värdetrakter etc.).\n\n`;
md += '```text\n';
md += relevant.join('\n');
md += '\n```\n\n';

md += `## ❌ Irrelevant (Kommer ignoreras)\n`;
md += `Dessa filer handlar om vägbeläggningar, järnvägsräls, fartkameror och topografi-kartor som inte direkt tillför miljötillsyn.\n\n`;
md += '```text\n';
md += irrelevant.slice(0, 50).join('\n') + (irrelevant.length > 50 ? `\n...och ${irrelevant.length - 50} till.` : '');
md += '\n```\n';

fs.writeFileSync('C:\\Users\\jimmy\\.gemini\\antigravity\\brain\\84c89746-caa6-4675-a15c-9c46cbf312b0\\geodata_review.md', md);
