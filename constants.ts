
import { Permit, DecisionType, WasteCode, Receiver, ProjectPhase, IntegrationSource } from './types';

export const INTEGRATION_SOURCES: IntegrationSource[] = [
  // Prioritet 1: Måste ha
  { id: '1', name: 'Administrativ Indelning', provider: 'Lantmäteriet', dataType: 'Inspire Download', status: 'CONNECTED', lastSync: 'Månadsvis', complexity: 2 },
  { id: '2', name: 'Hydrografi', provider: 'Lantmäteriet', dataType: 'Nedladdning', status: 'CONNECTED', lastSync: 'Månadsvis', complexity: 3 },
  { id: '3', name: 'Marktäcke', provider: 'Lantmäteriet', dataType: 'Inspire Download', status: 'CONNECTED', lastSync: 'Månadsvis', complexity: 4 },
  { id: '4', name: 'Fastighetsområden', provider: 'Lantmäteriet', dataType: 'Download', status: 'CONNECTED', lastSync: 'Dagligen', complexity: 4 },
  { id: '5', name: 'NVR & Natura 2000', provider: 'Naturvårdsverket', dataType: 'API (Öppen)', status: 'CONNECTED', lastSync: 'Nattlig', complexity: 3 },
  { id: '6', name: 'SGU Geologi', provider: 'SGU', dataType: 'API/Download', status: 'CONNECTED', lastSync: 'Månadsvis', complexity: 4 },
  // Prioritet 2: Bra att ha
  { id: '7', name: 'Belägenhetsadresser', provider: 'Lantmäteriet', dataType: 'Inspire Download', status: 'CONNECTED', lastSync: 'Månadsvis', complexity: 2 },
  { id: '8', name: 'Byggnader', provider: 'Lantmäteriet', dataType: 'Inspire Download', status: 'CONNECTED', lastSync: 'Månadsvis', complexity: 3 },
  { id: '9', name: 'Översvämningskartering', provider: 'MSB', dataType: 'WMS (Inspire)', status: 'CONNECTED', lastSync: '1h', complexity: 2 },
  { id: '10', name: 'Kulturmiljö (RAÄ)', provider: 'Riksantikvarieämbetet', dataType: 'WMS (Fornsök)', status: 'CONNECTED', lastSync: 'Realtid', complexity: 2 },
  { id: '11', name: 'Vattenförekomster (VISS)', provider: 'Länsstyrelsen', dataType: 'API (Öppen)', status: 'CONNECTED', lastSync: 'Veckovis', complexity: 3 },
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
        'Upprätta mottagningskontroll för varje lass'
      ]
    }
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
        'Hårdgjord yta krävs ej vid korta ledtider, men rekommenderas'
      ]
    }
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
        'Absorberingsmedel ska finnas lättillgängligt'
      ]
    }
  },
  {
    code: '90.80',
    name: 'Sortering och harpning av icke-farligt avfall',
    type: 'SNI',
    requirements: {
      storageTime: 'Max 1 år',
      maxAmount: 'Anmälan krävs vid >1 000 ton per kalenderår',
      legalReference: 'Miljöprövningsförordningen 29 kap. 80 §',
      checklist: [
        'Redovisa maskinell utrustning',
        'Beskriv åtgärder för dammbekämpning'
      ]
    }
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
      checklist: [
        'Bullerutredning krävs',
        'Vibrationskontroll vid krossning'
      ]
    }
  },
  {
    code: '17 05 04',
    name: 'Jord och sten (ej farligt avfall)',
    type: 'EWC',
    requirements: {
      storageTime: 'Max 1 år vid mellanlagring',
      legalReference: 'Avfallsförordningen Bilaga 3',
      checklist: []
    }
  },
  {
    code: '17 05 03*',
    name: 'Jord och sten som innehåller farliga ämnen',
    type: 'EWC',
    requirements: {
      storageTime: 'Max 6 månader',
      safetyDistance: 'Invallning krävs',
      legalReference: 'Avfallsförordningen Bilaga 3',
      checklist: []
    }
  }
];

export const MOCK_RECEIVERS: Receiver[] = [
  {
    id: 'R1',
    name: 'Gladö Kvarn Deponi',
    lat: 59.18,
    lng: 17.95,
    allowedCodes: ['17 05 04', '90.131'],
    type: 'DEPONI',
    isHazardousAllowed: false
  },
  {
    id: 'R2',
    name: 'Högbytorp Avfallsanläggning',
    lat: 59.52,
    lng: 17.65,
    allowedCodes: ['17 05 03*', '17 05 04'],
    type: 'DEPONI',
    isHazardousAllowed: true
  }
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
      { id: 'T2', title: 'Identifiera skyddade områden', startWeek: 1, duration: 1, type: 'LEGAL', status: 'DONE' }
    ]
  },
  {
    id: 'P2',
    title: 'Provtagning & Klassificering',
    status: 'ONGOING',
    isLocked: false,
    requiresSignature: true,
    tasks: [
      { id: 'T3', title: 'Provtagning (PFAS11 & Metaller)', startWeek: 2, duration: 2, type: 'FIELD', status: 'ONGOING' },
      { id: 'T4', title: 'Analysera labbsvar', startWeek: 4, duration: 1, type: 'TECHNICAL', status: 'TODO' }
    ]
  },
  {
    id: 'P3',
    title: 'Ansökan & Myndighetskontakt',
    status: 'TODO',
    isLocked: true,
    requiresSignature: true, // Stop Gate enligt affärsplan
    tasks: [
      { id: 'T5', title: 'Skapa MKB-utkast', startWeek: 5, duration: 3, type: 'LEGAL', status: 'TODO' },
      { id: 'T6', title: 'Skicka in anmälan', startWeek: 8, duration: 1, type: 'ADMIN', status: 'TODO' }
    ]
  }
];

export const MOCK_PERMITS: Permit[] = [
  {
    id: "1",
    filename: "Beslut_Haninge_2023_001.pdf",
    checksum: "sha256_88321903",
    received_date: "2023-10-15",
    property_id: "Länna 1:45",
    municipality: "Haninge",
    waste_codes: "90.131, 90.70",
    decision_type: DecisionType.BIFALL,
    full_text: "Haninge kommun har beslutat att bevilja tillstånd för mekanisk bearbetning och användning av avfall för anläggningsändamål på fastigheten Länna 1:45. Verksamhetskoderna 90.131 och 90.70 tillämpas med villkor om dammbekämpning...",
    processed_at: "2023-11-01 10:00:00",
    lat: 59.186,
    lng: 18.131,
    applicant_company: "Länna Mark & Schakt AB"
  },
  {
    id: "2",
    filename: "Avslag_Huddinge_Fastighet_A.pdf",
    checksum: "sha256_55219011",
    received_date: "2024-01-12",
    property_id: "Segeltorp 4:12",
    municipality: "Huddinge",
    waste_codes: "90.50",
    decision_type: DecisionType.AVSLAG,
    full_text: "Huddinge stad meddelar avslag för lagring av farligt avfall (90.50). Fastigheten bedöms ligga för nära vattenskyddsområde och de föreslagna invallningsåtgärderna anses otillräckliga för att förhindra spridning av föroreningar...",
    processed_at: "2024-01-15 09:30:00",
    lat: 59.270,
    lng: 17.935,
    applicant_company: "KemRisk Logistics"
  },
  {
    id: "3",
    filename: "Permit_Nacka_Industrial_Zone.pdf",
    checksum: "sha256_12239401",
    received_date: "2023-11-22",
    property_id: "Orminge 7:8",
    municipality: "Nacka",
    waste_codes: "90.120, 90.160",
    decision_type: DecisionType.BIFALL,
    full_text: "Nacka kommun godkänner sortering av byggavfall (90.120) och lagring av träavfall (90.160). Verksamheten ska bedrivas på hårdgjord yta med tät botten och oljeavskiljare...",
    processed_at: "2023-11-25 14:15:00",
    lat: 59.327,
    lng: 18.258,
    applicant_company: "ByggRetur Nacka AB"
  },
  {
    id: "4",
    filename: "Beslut_Orsa_Stackmora_2024.pdf",
    checksum: "sha256_orsa_312",
    received_date: "2024-03-01",
    property_id: "ORSA STACKMORA 3:12",
    municipality: "Orsa",
    waste_codes: "90.131",
    decision_type: DecisionType.BIFALL,
    full_text: "Beviljat tillstand for masshantering i Orsa Stackmora.",
    processed_at: "2024-03-05 10:00:00",
    lat: 61.134,
    lng: 14.665,
    applicant_company: "Orsa Gräv & Schakt"
  }
];

// MOCK DATA FÖR AUTOMATISK PROJEKTUPPSTART (DEL 3)
export const MOCK_PROPERTY_DATA = {
  propertyId: "Länna 1:45",
  municipality: "Haninge",
  county: "Stockholm",
  constraints: [
    { type: "NATURA2000", name: "Tyresta-Åva", distance: "1.2 km", status: "OK" },
    { type: "VATTENSKYDD", name: "Drevviken VSO", distance: "0 km (Inom område)", status: "WARNING" },
    { type: "FORNLÄMNING", name: "Röse L123 (Fornsök)", distance: "250 m", status: "INFO" }
  ],
  suggestedWBS: [
    { phase: "Förstudie", tasks: ["Samråd med Länsstyrelsen (pga Vattenskydd)", "Markundersökning (SGU: Lera)", "Kontroll av invasiva arter (SLU)"] },
    { phase: "Ansökan", tasks: ["Upprätta MKB", "Teknisk beskrivning av invallning"] },
    { phase: "Drift", tasks: ["Löpande kontroll av grundvattenrör"] }
  ]
};

