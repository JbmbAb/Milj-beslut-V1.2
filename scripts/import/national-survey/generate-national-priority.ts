/**
 * generate-national-priority.ts
 * 
 * Mimer Bibliotekarie: Analyserar 2000+ dataset från Länsstyrelsen och
 * skapar en fasanpassad prioriteringslista (Markdown) för nedladdning.
 */

import * as fs from 'fs';
import * as path from 'path';

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err || '')
};

const INPUT_JSON = path.join(process.cwd(), 'knowledge-base/lansstyrelsen-geodata/service-links.json');
const OUTPUT_MD = path.join(process.cwd(), 'knowledge-base/NATIONAL_HARVESTING_PHASES.md');

interface RecordWithLinks {
  id: string;
  title: string;
  links: string[];
}

// Definition av faser
const phases = [
  {
    phase: 1,
    name: 'Kritiska Skyddszoner (No-Go & Höga Krav)',
    description: 'Områden med omedelbar påverkan på tillstånd (särskilt enskilda avlopp och C-anmälningar).',
    keywords: ['vattenskydd', 'naturreservat', 'natura 2000', 'strandskydd', 'våtmark', 'nationalpark'],
    matches: [] as RecordWithLinks[]
  },
  {
    phase: 2,
    name: 'Hydrologi & Geoteknisk Risk',
    description: 'Avgörande för teknisk utformning (t.ex. infiltrationsförmåga, risk för utsläpp).',
    keywords: ['översvämning', 'skred', 'grundvatten', 'ytvatten', 'avrinningsområde', 'förorenad', 'ras'],
    matches: [] as RecordWithLinks[]
  },
  {
    phase: 3,
    name: 'Kulturmiljö & Riksintressen',
    description: 'Viktigt för lokaliseringsutredningar och större markarbeten.',
    keywords: ['fornlämning', 'kultur', 'riksintresse', 'rennäring', 'försvarsmakt'],
    matches: [] as RecordWithLinks[]
  },
  {
    phase: 4,
    name: 'Markanvändning & Bebyggelse',
    description: 'Kontextuell data för att förstå närmiljön.',
    keywords: ['bebyggelse', 'markanvändning', 'översiktsplan', 'detaljplan', 'buller', 'infrastruktur'],
    matches: [] as RecordWithLinks[]
  }
];

function generateReport() {
  if (!fs.existsSync(INPUT_JSON)) {
    logger.error('Kunde inte hitta service-links.json. Kör export_lansstyrelsen_geodata_service_index.ts först.');
    return;
  }

  const data = JSON.parse(fs.readFileSync(INPUT_JSON, 'utf8'));
  const records: RecordWithLinks[] = data.records || [];

  // Sortera in i faser
  let unassignedCount = 0;
  for (const record of records) {
    const titleLower = record.title.toLowerCase();
    let assigned = false;

    for (const phase of phases) {
      if (phase.keywords.some(kw => titleLower.includes(kw))) {
        phase.matches.push(record);
        assigned = true;
        break; // Lägg i den högsta (lägsta siffra) fasen som matchar
      }
    }
    if (!assigned) unassignedCount++;
  }

  // Skapa Markdown
  let md = `# Strategi för Inhämtning: Nationell Geodata (Mimers Brunn)\n\n`;
  md += `Detta dokument definierar hur Mimer Bibliotekarie prioriterar och fasar in de ${records.length} nationella dataset som identifierats från Länsstyrelsernas Geodatakatalog.\n\n`;
  
  for (const phase of phases) {
    md += `## Fas ${phase.phase}: ${phase.name}\n`;
    md += `**Fokus:** ${phase.description}\n`;
    md += `**Identifierade dataset:** ${phase.matches.length} st\n\n`;
    
    // Lista topp 10 som exempel
    md += `### Exempel på dataset att ladda ner i denna fas:\n`;
    const samples = phase.matches.slice(0, 10);
    for (const sample of samples) {
      md += `- **${sample.title}** (ID: \`${sample.id}\`)\n`;
    }
    if (phase.matches.length > 10) {
      md += `- *(...och ytterligare ${phase.matches.length - 10} dataset)*\n`;
    }
    md += `\n---\n\n`;
  }

  md += `## Fas 5: Rest-dataset (Övrigt)\n`;
  md += `**Fokus:** Dataset som inte träffade nyckelorden för miljö/risk/kultur.\n`;
  md += `**Identifierade dataset:** ${unassignedCount} st\n`;
  md += `*Strategi:* Manuellt urval vid behov. Spara bandbredd och lagring.\n`;

  fs.writeFileSync(OUTPUT_MD, md);
  logger.info(`Prioriteringslista genererad och sparad till: ${OUTPUT_MD}`);
}

generateReport();
