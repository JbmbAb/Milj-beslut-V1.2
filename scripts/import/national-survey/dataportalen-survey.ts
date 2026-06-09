/**
 * dataportalen-survey.ts
 * 
 * Mimer Bibliotekarie: Fas 1 (Wide Survey) - Sveriges Dataportal.
 * Söker systematiskt efter relevant miljödata via Dataportalens sök-API.
 */

import * as fs from 'fs';
import * as path from 'path';

// Basic logger mock
const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string, err: any) => console.error(`[ERROR] ${msg}`, err)
};

// Dataportalens sök-API (baserat på DCAT-AP)
const DATAPORTAL_SEARCH_API = 'https://dataportal.se/api/datasets?q=';

// Relevanta sökord och myndigheter
const ENVIRONMENTAL_KEYWORDS = [
  'avlopp', 'grundvatten', 'vattenskydd', 'förorenad mark', 
  'miljöfarlig verksamhet', 'kulturmiljö', 'naturreservat', 'översvämning'
];

const TARGET_PUBLISHERS = [
  'Naturvårdsverket',
  'Havs- och vattenmyndigheten',
  'Statens geotekniska institut',
  'Sveriges geologiska undersökning'
];

interface DataportalDataset {
  id: string;
  title: string;
  publisher: string;
  description: string;
  url: string;
}

async function fetchRelevantDatasets(keyword: string): Promise<DataportalDataset[]> {
  logger.info(`Söker på Dataportalen efter: ${keyword}...`);
  try {
    const response = await fetch(`${DATAPORTAL_SEARCH_API}${encodeURIComponent(keyword)}&limit=100`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const datasets: DataportalDataset[] = [];

    // Filter and map the results
    for (const hit of data.hits || []) {
      const publisherName = hit.publisher?.name || 'Okänd';
      
      // Filtrera på relevanta utgivare om det inte är en uppenbar träff
      if (TARGET_PUBLISHERS.some(p => publisherName.includes(p)) || hit.title.toLowerCase().includes(keyword)) {
        datasets.push({
          id: hit.id,
          title: hit.title,
          publisher: publisherName,
          description: hit.description?.substring(0, 150) + '...',
          url: `https://dataportal.se/datasets/${hit.id}`
        });
      }
    }
    return datasets;
  } catch (error) {
    logger.error(`Misslyckades att söka efter ${keyword}`, error);
    return [];
  }
}

async function runDataportalenSurvey() {
  logger.info('Mimer Bibliotekarie: Startar riktad Wide Survey mot Dataportalen.se...');
  
  const allResults: DataportalDataset[] = [];
  const seenIds = new Set<string>();

  for (const keyword of ENVIRONMENTAL_KEYWORDS) {
    const datasets = await fetchRelevantDatasets(keyword);
    
    for (const ds of datasets) {
      if (!seenIds.has(ds.id)) {
        seenIds.add(ds.id);
        allResults.push(ds);
      }
    }
    // Polite scraping delay
    await new Promise(r => setTimeout(r, 1000));
  }

  const outDir = path.join('storage/import-archive/metadata/national/2026');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'dataportalen_relevant_index.json');
  
  fs.writeFileSync(outFile, JSON.stringify(allResults, null, 2));
  logger.info(`Dataportalen Survey klar. ${allResults.length} unika, relevanta dataset identifierade och sparade till ${outFile}.`);
}

runDataportalenSurvey().catch(err => logger.error('Dataportalen Survey failed', err));
