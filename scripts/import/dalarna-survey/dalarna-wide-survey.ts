/**
 * dalarna-wide-survey.ts
 * 
 * Mimer Bibliotekarie: Fas 1 - Wide Survey för Dalarna.
 * Samlar metadata från Mora, Orsa, Falun och Borlänge.
 */

import { LibrarianService } from '../../../server/services/librarianService';
import { logger } from '../../../server/logger';
import * as fs from 'fs';
import * as path from 'path';

async function runDalarnaSurvey() {
  logger.info('Mimer Bibliotekarie: Startar Wide Survey för Dalarna (Fas 1)...');

  // 1. Mora/Orsa (Protokoll-baserad survey)
  const moraOrsaPlan = await LibrarianService.planHarvesting({
    datasetName: 'Miljönämndens Protokoll',
    provider: 'Mora-Orsa Miljökontor',
    sourceUrl: 'https://www.morakommun.se/kommun-och-politik/politik-och-demokrati/protokoll/protokoll-miljo--och-byggnadsnamnd.html',
    format: 'PDF',
    description: 'Årliga protokollsamlingar för 2024-2026.'
  });
  console.log('--- Mora/Orsa Plan ---\n', moraOrsaPlan);

  // 2. Falun (Webbdiarie-baserad survey)
  const falunPlan = await LibrarianService.planSelectiveScraping(
    'https://webbdiarium.falun.se/webdiary',
    'Diarie: MSN, Registreringsdatum: 2024-01-01 till 2026-12-31'
  );
  console.log('--- Falun Plan ---\n', falunPlan);

  // 3. Borlänge (Handlingar-baserad survey)
  const borlangePlan = await LibrarianService.planDiaryIntegration(
    'Miljö- och samhällsbyggnadsnämnden',
    'Borlänge kommun'
  );
  console.log('--- Borlänge Plan ---\n', borlangePlan);

  logger.info('Mimer Bibliotekarie: Survey-planer genererade. Redo för exekvering efter granskning.');
}

runDalarnaSurvey().catch(err => {
  logger.error('Dalarna Wide Survey failed', err);
  process.exit(1);
});
