import { WasteCode, ProjectPhase, IntegrationSource } from './types';

export const INTEGRATION_SOURCES: IntegrationSource[] = [
  // Prioritet 1: Måste ha
  {
    id: '1',
    name: 'Administrativ Indelning',
    provider: 'Lantmäteriet',
    dataType: 'Inspire Download',
    status: 'CONNECTED',
    lastSync: 'Månadsvis',
    complexity: 2,
  },
  {
    id: '2',
    name: 'Hydrografi',
    provider: 'Lantmäteriet',
    dataType: 'Nedladdning',
    status: 'CONNECTED',
    lastSync: 'Månadsvis',
    complexity: 3,
  },
  {
    id: '3',
    name: 'Marktäcke',
    provider: 'Lantmäteriet',
    dataType: 'Inspire Download',
    status: 'CONNECTED',
    lastSync: 'Månadsvis',
    complexity: 4,
  },
  {
    id: '4',
    name: 'Fastighetsområden',
    provider: 'Lantmäteriet',
    dataType: 'Download',
    status: 'CONNECTED',
    lastSync: 'Dagligen',
    complexity: 4,
  },
  {
    id: '5',
    name: 'NVR & Natura 2000',
    provider: 'Naturvårdsverket',
    dataType: 'API (Öppen)',
    status: 'CONNECTED',
    lastSync: 'Nattlig',
    complexity: 3,
  },
  {
    id: '6',
    name: 'SGU Geologi',
    provider: 'SGU',
    dataType: 'API/Download',
    status: 'CONNECTED',
    lastSync: 'Månadsvis',
    complexity: 4,
  },
  // Prioritet 2: Bra att ha
  {
    id: '7',
    name: 'Belägenhetsadresser',
    provider: 'Lantmäteriet',
    dataType: 'Inspire Download',
    status: 'CONNECTED',
    lastSync: 'Månadsvis',
    complexity: 2,
  },
  {
    id: '8',
    name: 'Byggnader',
    provider: 'Lantmäteriet',
    dataType: 'Inspire Download',
    status: 'CONNECTED',
    lastSync: 'Månadsvis',
    complexity: 3,
  },
  {
    id: '9',
    name: 'Översvämningskartering',
    provider: 'MSB',
    dataType: 'WMS (Inspire)',
    status: 'CONNECTED',
    lastSync: '1h',
    complexity: 2,
  },
  {
    id: '10',
    name: 'Kulturmiljö (RAÄ)',
    provider: 'Riksantikvarieämbetet',
    dataType: 'WMS (Fornsök)',
    status: 'CONNECTED',
    lastSync: 'Realtid',
    complexity: 2,
  },
  {
    id: '11',
    name: 'Vattenförekomster (VISS)',
    provider: 'Länsstyrelsen',
    dataType: 'API (Öppen)',
    status: 'CONNECTED',
    lastSync: 'Veckovis',
    complexity: 3,
  },
];

export const WASTE_CODES: WasteCode[] = [
  {
    code: '90.131',
    name: 'Användning av avfall för anläggningsändamål (ringa risk)',
    type: 'SNI',
    requirements: {
      storageTime: 'Max 3 år',
      maxAmount: 'Obegränsad vid ringa risk',
      safetyDistance: '50m till bostäder',
      legalReference: 'Miljöprövningsförordningen 29 kap. 31 §',
      checklist: [
        'Verifiera "Ringa risk" mot Naturvårdsverkets riktvärden (KM/MKM)',
        'Säkerställ att ingen damning sker mot grannfastighet',
        'Upprätta mottagningskontroll för varje lass',
      ],
    },
  },
  {
    code: '90.30',
    name: 'Mellanlagring av icke-farligt avfall',
    type: 'SNI',
    requirements: {
      storageTime: 'Max 1 år',
      maxAmount: 'Anmälan krävs vid >10 ton vid ett tillfälle',
      legalReference: 'Miljöprövningsförordningen 29 kap. 30 §',
      checklist: [
        'Anmälan ska ske senast 6 veckor innan start',
        'Hårdgjord yta krävs ej vid korta ledtider, men rekommenderas',
      ],
    },
  },
  {
    code: '90.50',
    name: 'Lagring av farligt avfall',
    type: 'SNI',
    requirements: {
      storageTime: 'Max 6 månader',
      maxAmount: 'Anmälan <25 ton. Tillstånd >25 ton.',
      safetyDistance: 'Invallning och spillskydd obligatoriskt',
      legalReference: 'Miljöprövningsförordningen 29 kap. 50 §',
      checklist: [
        'Invallning måste rymma största behållarens volym + 10%',
        'Tät yta (asfalt/betong) är ett absolut krav',
        'Absorberingsmedel ska finnas lättillgängligt',
      ],
    },
  },
  {
    code: '90.80',
    name: 'Sortering och harpning av icke-farligt avfall',
    type: 'SNI',
    requirements: {
      storageTime: 'Max 1 år',
      maxAmount: 'Anmälan krävs vid >1 000 ton per kalenderår',
      legalReference: 'Miljöprövningsförordningen 29 kap. 80 §',
      checklist: ['Redovisa maskinell utrustning', 'Beskriv åtgärder för dammbekämpning'],
    },
  },
  {
    code: '90.110',
    name: 'Mekanisk bearbetning (krossning/siktning)',
    type: 'SNI',
    requirements: {
      storageTime: 'Max 1 år',
      maxAmount: 'Anmälan <10 000 ton/år. Tillstånd >10 000 ton.',
      safetyDistance: 'Bullerdämpande åtgärder krävs',
      legalReference: 'Miljöprövningsförordningen 29 kap. 110 §',
      checklist: ['Bullerutredning krävs', 'Vibrationskontroll vid krossning'],
    },
  },
  {
    code: '17 05 04',
    name: 'Jord och sten (ej farligt avfall)',
    type: 'EWC',
    requirements: {
      storageTime: 'Max 1 år vid mellanlagring',
      legalReference: 'Avfallsförordningen Bilaga 3',
      checklist: [],
    },
  },
  {
    code: '17 05 03*',
    name: 'Jord och sten som innehåller farliga ämnen',
    type: 'EWC',
    requirements: {
      storageTime: 'Max 6 månader',
      safetyDistance: 'Invallning krävs',
      legalReference: 'Avfallsförordningen Bilaga 3',
      checklist: [],
    },
  },
];

export const DEFAULT_PHASES: ProjectPhase[] = [
  {
    id: 'P1',
    title: 'Förstudie & Platsanalys',
    status: 'DONE',
    isLocked: false,
    requiresSignature: false,
    tasks: [
      { id: 'T1', title: 'Hämta fastighetsdata', startWeek: 1, duration: 1, type: 'ADMIN', status: 'DONE' },
      {
        id: 'T2',
        title: 'Identifiera skyddade områden',
        startWeek: 1,
        duration: 1,
        type: 'LEGAL',
        status: 'DONE',
      },
    ],
  },
  {
    id: 'P2',
    title: 'Provtagning & Klassificering',
    status: 'ONGOING',
    isLocked: false,
    requiresSignature: true,
    tasks: [
      {
        id: 'T3',
        title: 'Provtagning (PFAS11 & Metaller)',
        startWeek: 2,
        duration: 2,
        type: 'FIELD',
        status: 'ONGOING',
      },
      { id: 'T4', title: 'Analysera labbsvar', startWeek: 4, duration: 1, type: 'TECHNICAL', status: 'TODO' },
    ],
  },
  {
    id: 'P3',
    title: 'Ansökan & Myndighetskontakt',
    status: 'TODO',
    isLocked: true,
    requiresSignature: true, // Stop Gate enligt affärsplan
    tasks: [
      { id: 'T5', title: 'Skapa MKB-utkast', startWeek: 5, duration: 3, type: 'LEGAL', status: 'TODO' },
      { id: 'T6', title: 'Skicka in anmälan', startWeek: 8, duration: 1, type: 'ADMIN', status: 'TODO' },
    ],
  },
];
