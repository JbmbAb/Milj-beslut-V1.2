export type FoundationLegalInstrumentType = 'LAW' | 'ORDINANCE';

export interface FoundationLegalSourceDefinition {
  id: string;
  externalId: string;
  title: string;
  shortTitle: string;
  instrumentType: FoundationLegalInstrumentType;
  authorityName: string;
  authorityType: string;
  legalArea: string;
  sourceUrl: string;
  summary: string;
  keywords: string[];
}

export const FOUNDATION_LEGAL_SOURCES: readonly FoundationLegalSourceDefinition[] = [
  {
    id: 'foundation.mb',
    externalId: 'SFS:1998:808',
    title: 'Miljöbalken (1998:808)',
    shortTitle: 'Miljöbalken',
    instrumentType: 'LAW',
    authorityName: 'Riksdagen',
    authorityType: 'Statlig',
    legalArea: 'Miljö',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=1998:808',
    summary:
      'Grundlagstiftning för miljöskydd, hushållning med mark och vatten samt tillstånds- och tillsynsfrågor.',
    keywords: ['miljöbalken', 'mb', 'miljö', 'tillstånd', 'tillsyn'],
  },
  {
    id: 'foundation.mpf',
    externalId: 'SFS:2013:251',
    title: 'Miljöprövningsförordningen (2013:251)',
    shortTitle: 'Miljöprövningsförordningen',
    instrumentType: 'ORDINANCE',
    authorityName: 'Regeringen',
    authorityType: 'Statlig',
    legalArea: 'Miljö',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=2013:251',
    summary:
      'Förordning som anger prövningspliktiga miljöfarliga verksamheter och hur verksamheter klassificeras för anmälan och tillstånd.',
    keywords: ['miljöprövningsförordningen', 'mpf', 'anmälan', 'tillstånd', 'verksamhetskod'],
  },
  {
    id: 'foundation.avfallsforordningen',
    externalId: 'SFS:2020:614',
    title: 'Avfallsförordningen (2020:614)',
    shortTitle: 'Avfallsförordningen',
    instrumentType: 'ORDINANCE',
    authorityName: 'Regeringen',
    authorityType: 'Statlig',
    legalArea: 'Miljö',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=2020:614',
    summary:
      'Förordning som reglerar klassificering, hantering, anteckningsskyldighet och transportdokumentation för avfall och farligt avfall.',
    keywords: ['avfallsförordningen', 'avfall', 'farligt avfall', 'ewc', 'transportdokument'],
  },
  {
    id: 'foundation.pbl',
    externalId: 'SFS:2010:900',
    title: 'Plan- och bygglagen (2010:900)',
    shortTitle: 'Plan- och bygglagen',
    instrumentType: 'LAW',
    authorityName: 'Riksdagen',
    authorityType: 'Statlig',
    legalArea: 'Plan och bygg',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=2010:900',
    summary:
      'Grundlagstiftning for planläggning, lov, byggande och markanvandning med koppling till bygglovs- och planprocesser.',
    keywords: ['plan- och bygglagen', 'pbl', 'bygglov', 'detaljplan', 'planläggning'],
  },
  {
    id: 'foundation.pbf',
    externalId: 'SFS:2011:338',
    title: 'Plan- och byggförordningen (2011:338)',
    shortTitle: 'Plan- och byggförordningen',
    instrumentType: 'ORDINANCE',
    authorityName: 'Regeringen',
    authorityType: 'Statlig',
    legalArea: 'Plan och bygg',
    sourceUrl: 'https://rkrattsbaser.gov.se/sfst?bet=2011:338',
    summary:
      'Förordning som kompletterar plan- och bygglagen med närmare bestämmelser om lov, anmälan, tekniska krav och handläggning.',
    keywords: ['plan- och byggförordningen', 'pbf', 'anmälan', 'tekniska krav', 'byggprocess'],
  },
];
