/**
 * _shared.ts â€“ Gemensamma hjÃ¤lpfunktioner fÃ¶r alla backfill-skript
 */
import crypto from 'node:crypto';
import { prisma } from '../../server/db/prisma';

// â”€â”€â”€ Confidence-trÃ¶sklar (fÃ¤ltvisa, lÃ¥sta) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const CONFIDENCE_THRESHOLDS = {
    municipality: 0.90,
    legalStatus: 0.90,  // diarie
    decisionType: 0.85,
    activityCode: 0.30, // Lowered from 0.40
    wasteType: 0.40,
} as const;

export type MetadataField = keyof typeof CONFIDENCE_THRESHOLDS;

// â”€â”€â”€ LLM-instÃ¤llningar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const LLM = {
    maxRetries: 2,
    timeoutMs: 15_000,
} as const;

// â”€â”€â”€ LLM-prompter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const LLM_PROMPT_METADATA = `Svara ENBART med giltig JSON med strukturen:
{
  "municipality": { "value": "Nacka" eller null, "confidence": 0.0-1.0 },
  "legalStatus": { "value": "dnr 2024-12345" eller null, "confidence": 0.0-1.0 },
  "decisionType": { "value": "Beslut", "AnmÃ¤lan", "Tillsyn" etc or null, "confidence": 0.0-1.0 },
  "activityCode": { "value": "90.40" (avfall), "90.30" (massor), "06.00" (energi) etc or null, "confidence": 0.0-1.0 },
  "wasteType": { "value": "Farligt avfall", "Schaktmassor", "Matjord" etc or null, "confidence": 0.0-1.0 }
}
VIKTIGT: Om du kan gissa verksamhetskoden (activityCode) baserat pÃ¥ texten (t.ex. om de pratar om 'mellanlagring av avfall' -> 90.40), gÃ¶r det och sÃ¤tt confidence efter hur sÃ¤ker du Ã¤r.
SÃ¤tt confidence till 0 om du inte kan gÃ¶ra en kvalificerad gissning.`;

// â”€â”€â”€ Batch-storlekar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const BATCH = {
    metadataPass: 200,
    ocrText: 25,
    llmPass: 10,
    requirements: 20,
} as const;

// â”€â”€â”€ 290 svenska kommuner (normaliserade nycklar â†’ visningsnamn) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Trunkerad lista; komplettera med alla 290 vid behov.
export const MUNICIPALITY_MAP: Record<string, string> = {
    'ale': 'Ale', 'alingsas': 'AlingsÃ¥s', 'alvesta': 'Alvesta', 'aneby': 'Aneby',
    'arboga': 'Arboga', 'arjeplog': 'Arjeplog', 'arvidsjaur': 'Arvidsjaur',
    'arvika': 'Arvika', 'askersund': 'Askersund', 'avesta': 'Avesta',
    'bastad': 'BÃ¥stad', 'bÃ¥stad': 'BÃ¥stad', 'bengtsfors': 'Bengtsfors', 'berg': 'Berg', 'bjuv': 'Bjuv',
    'boden': 'Boden', 'bollebygd': 'Bollebygd', 'bollnÃ¤s': 'BollnÃ¤s', 'bolinas': 'BolinÃ¤s',
    'boras': 'BorÃ¥s', 'borlange': 'BorlÃ¤nge', 'borgholm': 'Borgholm', 'bromolla': 'BromÃ¶lla',
    'bracke': 'BrÃ¤cke', 'burlav': 'BurlÃ¶v', 'danderyd': 'Danderyd',
    'degerfors': 'Degerfors', 'dals-ed': 'Dals-Ed', 'dannemora': 'Dannemora',
    'ekerÃ¶': 'EkerÃ¶', 'eksjÃ¶': 'EksjÃ¶', 'emmaboda': 'Emmaboda', 'enkÃ¶ping': 'EnkÃ¶ping', 'eskilstuna': 'Eskilstuna', 'eslov': 'EslÃ¶v', 'fagersta': 'Fagersta',
    'falkenberg': 'Falkenberg', 'falkÃ¶ping': 'FalkÃ¶ping', 'falun': 'Falun',
    'filipstad': 'Filipstad', 'finspang': 'FinspÃ¥ng', 'flen': 'Flen',
    'forshaga': 'Forshaga', 'froson': 'FrÃ¶sÃ¶n', 'gagnef': 'Gagnef',
    'gislaved': 'Gislaved', 'gnesta': 'Gnesta', 'gÃ¤llivare': 'GÃ¤llivare', 'gavle': 'GÃ¤vle', 'goteborg': 'GÃ¶teborg',
    'gotland': 'Gotland', 'grums': 'Grums', 'grÃ¤storp': 'GrÃ¤storp',
    'habo': 'Habo', 'hagfors': 'Hagfors', 'hallsberg': 'Hallsberg',
    'hallstahammar': 'Hallstahammar', 'halmstad': 'Halmstad',
    'hammarÃ¶': 'HammarÃ¶', 'haninge': 'Haninge', 'haparanda': 'Haparanda',
    'heby': 'Heby', 'hedemora': 'Hedemora', 'helsingborg': 'Helsingborg',
    'herrljunga': 'Herrljunga', 'hjo': 'Hjo', 'hofors': 'Hofors',
    'huddinge': 'Huddinge', 'hudiksvall': 'Hudiksvall', 'hull': 'Hult',
    'hÃ¤rnÃ¶sand': 'HÃ¤rnÃ¶sand', 'hÃ¤ssleholm': 'HÃ¤ssleholm', 'hoganas': 'HÃ¶ganÃ¤s', 'hogsby': 'HÃ¶gsby',
    'horby': 'HÃ¶rby', 'hÃ¶Ã¶r': 'HÃ¶Ã¶r', 'jarfalla': 'JÃ¤rfÃ¤lla',
    'jokkmokk': 'Jokkmokk', 'jonkoping': 'JÃ¶nkÃ¶ping', 'kalix': 'Kalix',
    'kalmar': 'Kalmar', 'karlsborg': 'Karlsborg', 'karlshamn': 'Karlshamn',
    'karlskoga': 'Karlskoga', 'karlskrona': 'Karlskrona', 'karlstad': 'Karlstad',
    'katrineholm': 'Katrineholm', 'kil': 'Kil', 'kinda': 'Kinda',
    'kiruna': 'Kiruna', 'klippan': 'Klippan', 'knivsta': 'Knivsta',
    'kramfors': 'Kramfors', 'kristianstad': 'Kristianstad',
    'kristinehamn': 'Kristinehamn', 'krokom': 'Krokom', 'kumla': 'Kumla',
    'kungsbacka': 'Kungsbacka', 'kungsÃ¶r': 'KungsÃ¶r', 'kungÃ¤lv': 'KungÃ¤lv',
    'kÃ¤vlinge': 'KÃ¤vlinge', 'kÃ¶ping': 'KÃ¶ping', 'laholm': 'Laholm',
    'landskrona': 'Landskrona', 'laxÃ¥': 'LaxÃ¥', 'lekeberg': 'Lekeberg',
    'leksand': 'Leksand', 'lerum': 'Lerum', 'lessebo': 'Lessebo',
    'lidingÃ¶': 'LidingÃ¶', 'lidkÃ¶ping': 'LidkÃ¶ping', 'lilla edet': 'Lilla Edet',
    'lindesberg': 'Lindesberg', 'linkÃ¶ping': 'LinkÃ¶ping', 'ljungby': 'Ljungby',
    'ljusdal': 'Ljusdal', 'ljusnarsberg': 'Ljusnarsberg', 'ludvika': 'Ludvika',
    'luleÃ¥': 'LuleÃ¥', 'lund': 'Lund', 'lycksele': 'Lycksele',
    'lysekil': 'Lysekil', 'malmÃ¶': 'MalmÃ¶', 'malung-sÃ¤len': 'Malung-SÃ¤len', 'malÃ¥': 'MalÃ¥',
    'mariestad': 'Mariestad', 'mark': 'Mark', 'markaryd': 'Markaryd',
    'mellerud': 'Mellerud', 'mjÃ¶lby': 'MjÃ¶lby', 'mora': 'Mora',
    'motala': 'Motala', 'mullsjÃ¶': 'MullsjÃ¶', 'munkedal': 'Munkedal',
    'munkfors': 'Munkfors', 'mÃ¶lndal': 'MÃ¶lndal', 'mÃ¶nsterÃ¥s': 'MÃ¶nsterÃ¥s',
    'mÃ¶rbylÃ¥nga': 'MÃ¶rbylÃ¥nga', 'nacka': 'Nacka', 'nora': 'Nora',
    'norberg': 'Norberg', 'nordanstig': 'Nordanstig', 'nordmaling': 'Nordmaling',
    'norrtÃ¤lje': 'NorrtÃ¤lje', 'norrkÃ¶ping': 'NorrkÃ¶ping', 'norsjÃ¶': 'NorsjÃ¶',
    'nybro': 'Nybro', 'nykvarn': 'Nykvarn', 'nykÃ¶ping': 'NykÃ¶ping',
    'nynÃ¤shamn': 'NynÃ¤shamn', 'nÃ¤ssjÃ¶': 'NÃ¤ssjÃ¶', 'ockelbo': 'Ockelbo',
    'olofstrÃ¶m': 'OlofstrÃ¶m', 'orsa': 'Orsa', 'orust': 'Orust',
    'osby': 'Osby', 'oskarshamn': 'Oskarshamn', 'ovanÃ¥ker': 'OvanÃ¥ker',
    'oxelÃ¶sund': 'OxelÃ¶sund', 'pajala': 'Pajala', 'partille': 'Partille',
    'perstorp': 'Perstorp', 'piteÃ¥': 'PiteÃ¥', 'ragunda': 'Ragunda',
    'robertsfors': 'Robertsfors', 'ronneby': 'Ronneby', 'rÃ¤ttvik': 'RÃ¤ttvik',
    'sala': 'Sala', 'salem': 'Salem', 'sandviken': 'Sandviken',
    'sigtuna': 'Sigtuna', 'simrishamn': 'Simrishamn', 'sjÃ¶bo': 'SjÃ¶bo',
    'skara': 'Skara', 'skellefteÃ¥': 'SkellefteÃ¥', 'skinnskatteberg': 'Skinnskatteberg',
    'skurup': 'Skurup', 'skÃ¶vde': 'SkÃ¶vde', 'smedjebacken': 'Smedjebacken',
    'sollefteÃ¥': 'SollefteÃ¥', 'sollentuna': 'Sollentuna', 'solna': 'Solna',
    'sorsele': 'Sorsele', 'sotenÃ¤s': 'SotenÃ¤s', 'staffanstorp': 'Staffanstorp',
    'stenungsund': 'Stenungsund', 'stockholm': 'Stockholm', 'storfors': 'Storfors',
    'storuman': 'Storuman', 'strÃ¤ngnÃ¤s': 'StrÃ¤ngnÃ¤s', 'strÃ¶mstad': 'StrÃ¶mstad',
    'strÃ¶msund': 'StrÃ¶msund', 'sundbyberg': 'Sundbyberg', 'sundsvall': 'Sundsvall',
    'sunne': 'Sunne', 'surahammar': 'Surahammar', 'svalÃ¶v': 'SvalÃ¶v',
    'svedala': 'Svedala', 'svenljunga': 'Svenljunga', 'sÃ¤ffle': 'SÃ¤ffle',
    'sÃ¤ter': 'SÃ¤ter', 'sÃ¤vsjÃ¶': 'SÃ¤vsjÃ¶', 'sÃ¶derhamn': 'SÃ¶derhamn', 'sÃ¶derkÃ¶ping': 'SÃ¶derkÃ¶ping',
    'sÃ¶dertÃ¤lje': 'SÃ¶dertÃ¤lje', 'sÃ¶lvesborg': 'SÃ¶lvesborg', 'tanum': 'Tanum',
    'tibro': 'Tibro', 'tidaholm': 'Tidaholm', 'tierp': 'Tierp',
    'timrÃ¥': 'TimrÃ¥', 'tingsryd': 'Tingsryd', 'tjÃ¶rn': 'TjÃ¶rn',
    'tomelilla': 'Tomelilla', 'torsby': 'Torsby', 'torsÃ¥s': 'TorsÃ¥s',
    'tranemo': 'Tranemo', 'tranÃ¥s': 'TranÃ¥s', 'trelleborg': 'Trelleborg',
    'trollhÃ¤ttan': 'TrollhÃ¤ttan', 'trosa': 'Trosa', 'tyresÃ¶': 'TyresÃ¶',
    'tÃ¤by': 'TÃ¤by', 'tÃ¶reboda': 'TÃ¶reboda', 'uddevalla': 'Uddevalla',
    'ulricehamn': 'Ulricehamn', 'umeÃ¥': 'UmeÃ¥', 'upplands vÃ¤sby': 'Upplands VÃ¤sby',
    'upplands-bro': 'Upplands-Bro', 'uppsala': 'Uppsala', 'utansjÃ¶': 'UtansjÃ¶',
    'vadstena': 'Vadstena', 'vaggeryd': 'Vaggeryd', 'valdemarsvik': 'Valdemarsvik',
    'vallentuna': 'Vallentuna', 'vansbro': 'Vansbro', 'vara': 'Vara',
    'varberg': 'Varberg', 'vaxholm': 'Vaxholm', 'vellinge': 'Vellinge',
    'vetlanda': 'Vetlanda', 'vilhelmina': 'Vilhelmina', 'vimmerby': 'Vimmerby',
    'vindeln': 'Vindeln', 'vingÃ¥ker': 'VingÃ¥ker', 'vÃ¥rgÃ¥rda': 'VÃ¥rgÃ¥rda',
    'vÃ¤nersborg': 'VÃ¤nersborg', 'vÃ¤rmdÃ¶': 'VÃ¤rmdÃ¶', 'vÃ¤rnamo': 'VÃ¤rnamo',
    'vÃ¤stervik': 'VÃ¤stervik', 'vÃ¤sterÃ¥s': 'VÃ¤sterÃ¥s', 'vÃ¤xjÃ¶': 'VÃ¤xjÃ¶',
    'ydre': 'Ydre', 'ystad': 'Ystad', 'Ã¥mÃ¥l': 'Ã…mÃ¥l', 'Ã¥re': 'Ã…re', 'Ã¥sele': 'Ã…sele',
    'Ã¤lmhult': 'Ã„lmhult', 'Ã¤lvdalen': 'Ã„lvdalen', 'Ã¤lvkarleby': 'Ã„lvkarleby',
    'Ã¤lvsbyn': 'Ã„lvsbyn', 'Ã¤ngelholm': 'Ã„ngelholm', 'Ã¶ckerÃ¶': 'Ã–ckerÃ¶',
    'Ã¶deshÃ¶g': 'Ã–deshÃ¶g', 'Ã¶rebro': 'Ã–rebro', 'Ã¶rkelljunga': 'Ã–rkelljunga',
    'Ã¶rnskÃ¶ldsvik': 'Ã–rnskÃ¶ldsvik', 'Ã¶stersund': 'Ã–stersund',
    'Ã¶sterÃ¥ker': 'Ã–sterÃ¥ker', 'Ã¶sthammar': 'Ã–sthammar', 'Ã¶stra gÃ¶inge': 'Ã–stra GÃ¶inge',
    'Ã¶verkalix': 'Ã–verkalix', 'Ã¶vertorneÃ¥': 'Ã–vertorneÃ¥'
};

/** Normaliserar ett rÃ¥a kommunnamn till en kanonisk form frÃ¥n listan ovan. */
export function normalizeMunicipality(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const cleaned = raw
        .toLowerCase()
        // Replace common Swedish word endings/prefixes if they are detached by space
        .replace(/\bkommun\b/g, '')
        .replace(/\bmiljÃ¶fÃ¶rvaltningen\b/g, '')
        .replace(/\bmiljÃ¶kontoret\b/g, '')
        .replace(/\bmiljÃ¶nÃ¤mnden\b/g, '')
        .replace(/\bstaden\b/g, '')
        // Do NOT use \b with characters that might have non-ASCII before it like 'Ã¥'
        // Just remove ' stad' or ' kommun' if they are clearly separated
        .replace(/\s+stad\b/g, '')
        .replace(/\s+kommun\b/g, '')
        .replace(/[^a-zÃ¥Ã¤Ã¶\s-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (MUNICIPALITY_MAP[cleaned]) return MUNICIPALITY_MAP[cleaned];

    // Robust cleaning: remove anything not being a letter, number, space or hyphen
    // We do this AFTER the direct map check to allow exact matches with special chars if they exist
    const normalized = cleaned
        .replace(/[^a-z0-9Ã¥Ã¤Ã¶\s-]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (MUNICIPALITY_MAP[normalized]) return MUNICIPALITY_MAP[normalized];

    // Create a version without Ã¥Ã¤Ã¶ for robust matching
    const stripAccents = (s: string) => s.replace(/[Ã¥Ã¤]/g, 'a').replace(/Ã¶/g, 'o');
    const cleanedStripped = stripAccents(normalized);

    // Check aliases first if any
    for (const [alias, display] of Object.entries(MUNICIPALITY_ALIASES)) {
        if (normalized.includes(alias.toLowerCase())) return display;
    }

    // Match against MAP keys
    const stripAll = (s: string) => stripAccents(s).replace(/\s+/g, '').replace(/-/g, '');
    const cleanedAll = stripAll(normalized);

    for (const [key, display] of Object.entries(MUNICIPALITY_MAP)) {
        const keyAll = stripAll(key);
        if (normalized === key || stripAccents(key) === cleanedStripped || cleanedAll === keyAll || (keyAll.length > 3 && cleanedAll.includes(keyAll))) {
            return display;
        }
    }

    return null;
}

// â”€â”€â”€ Municipality alias table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps common variants â†’ canonical municipality display name
const MUNICIPALITY_ALIASES: Record<string, string> = {
    // Stockholm
    'stockholms stad': 'Stockholm', 'stockholm stad': 'Stockholm',
    'miljÃ¶fÃ¶rvaltningen stockholm': 'Stockholm', 'miljÃ¶fÃ¶rvaltningen i stockholm': 'Stockholm',
    'sthlm': 'Stockholm', 'stockholms miljÃ¶fÃ¶rvaltning': 'Stockholm',
    // GÃ¶teborg
    'gÃ¶teborgs stad': 'GÃ¶teborg', 'gÃ¶teborgs miljÃ¶fÃ¶rvaltning': 'GÃ¶teborg',
    'miljÃ¶fÃ¶rvaltningen gÃ¶teborg': 'GÃ¶teborg', 'kretslopp och vatten': 'GÃ¶teborg',
    // MalmÃ¶
    'malmÃ¶ stad': 'MalmÃ¶', 'malmÃ¶ miljÃ¶fÃ¶rvaltning': 'MalmÃ¶',
    // Nacka
    'nacka kommun': 'Nacka', 'miljÃ¶enheten nacka': 'Nacka',
    // Uppsala
    'uppsala kommun': 'Uppsala', 'uppsala stad': 'Uppsala',
    // Ã–rebro
    'Ã¶rebro kommun': 'Ã–rebro',
    // LinkÃ¶ping
    'linkÃ¶pings kommun': 'LinkÃ¶ping',
    // VÃ¤sterÃ¥s
    'vÃ¤sterÃ¥s stad': 'VÃ¤sterÃ¥s',
    // Helsingborg
    'helsingborgs stad': 'Helsingborg',
    // NorrkÃ¶ping
    'norrkÃ¶pings kommun': 'NorrkÃ¶ping',
    // JÃ¶nkÃ¶ping
    'jÃ¶nkÃ¶pings kommun': 'JÃ¶nkÃ¶ping',
    // UmeÃ¥
    'umeÃ¥ kommun': 'UmeÃ¥',
    // Lund
    'lunds kommun': 'Lund',
    // BorÃ¥s
    'borÃ¥s stad': 'BorÃ¥s',
    // Aliases for missing or sub-entities
    'torstuna': 'EnkÃ¶ping',
    'nsr': 'Helsingborg', // NSR is based in Helsingborg
    'vmmf': 'VÃ¤stmanland-Dalarna (Multiple)', // Joint authority
    'bastad': 'BÃ¥stad',
    // Eskilstuna
    'eskilstuna kommun': 'Eskilstuna',
    // GÃ¤vle
    'gÃ¤vle kommun': 'GÃ¤vle',
    // SÃ¶dertÃ¤lje
    'sÃ¶dertÃ¤lje kommun': 'SÃ¶dertÃ¤lje',
    // Karlstad
    'karlstads kommun': 'Karlstad',
    // Sundsvall
    'sundsvalls kommun': 'Sundsvall',
    // Ã–stersund
    'Ã¶stersunds kommun': 'Ã–stersund',
    // TrollhÃ¤ttan
    'trollhÃ¤ttans stad': 'TrollhÃ¤ttan',
    // LuleÃ¥
    'luleÃ¥ kommun': 'LuleÃ¥',
    // Halmstad
    'halmstads kommun': 'Halmstad',
};

/**
 * Weighted municipality extraction from multiple signal sources.
 * Returns { value, confidence } where confidence is cumulative across sources.
 * Use this in pass1/pass2 instead of plain normalizeMunicipality for better coverage.
 */
export function extractMunicipalityWeighted(opts: {
    subject?: string;
    absolutePath?: string;
    senderDomain?: string;   // e.g. "nacka.se"
    senderEmail?: string;    // e.g. "karin@stockholm.se"
    bodyText?: string;
}): { value: string | null; confidence: number } {
    const scores = new Map<string, number>();

    const addScore = (candidate: string | null, weight: number) => {
        if (!candidate) return;
        scores.set(candidate, (scores.get(candidate) ?? 0) + weight);
    };

    // Helper: try to match municipality from any text
    const matchMuni = (text: string): string | null => {
        if (!text) return null;
        const lower = text.toLowerCase();
        // Try alias table first
        for (const [alias, display] of Object.entries(MUNICIPALITY_ALIASES)) {
            if (lower.includes(alias)) return display;
        }
        // Try canonical map
        return normalizeMunicipality(text);
    };

    // Signal 1: Subject line (+0.30)
    if (opts.subject) {
        const m = matchMuni(opts.subject);
        addScore(m, 0.30);
    }

    // Signal 2: File/folder path (+0.35)
    // Path segments often contain municipality name e.g. ".../Nacka/filename.pdf"
    if (opts.absolutePath) {
        const parts = opts.absolutePath.replace(/\\/g, '/').split('/');
        for (const part of parts) {
            const m = matchMuni(part);
            if (m) { addScore(m, 0.35); break; }
        }
    }

    // Signal 3: Sender domain e.g. @nacka.se â†’ +0.40
    const emailOrDomain = opts.senderEmail || opts.senderDomain || '';
    if (emailOrDomain) {
        const domain = emailOrDomain.includes('@') ? emailOrDomain.split('@')[1] : emailOrDomain;
        const domainBase = domain?.split('.')[0] ?? '';
        const m = matchMuni(domainBase);
        addScore(m, 0.40);
    }

    // Signal 4: First 500 chars of body text (+0.25)
    if (opts.bodyText) {
        const m = matchMuni(opts.bodyText.slice(0, 500));
        addScore(m, 0.25);
    }

    if (scores.size === 0) return { value: null, confidence: 0 };

    // Pick highest-scored candidate
    let best: string | null = null;
    let bestScore = 0;
    for (const [candidate, score] of scores.entries()) {
        if (score > bestScore) { best = candidate; bestScore = score; }
    }

    // Cap confidence at 0.97
    return { value: best, confidence: Math.min(0.97, bestScore) };
}

// â”€â”€â”€ Diarienummer-regex â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DIARIE_REGEX = /\b(?:dnr|diarienr(?:ummer)?|diarie)[\s.:/-]*([A-Z0-9][A-Z0-9.\-/]+)/i;

export function extractDiarie(text: string): string | null {
    const m = text.match(DIARIE_REGEX);
    return m ? m[1].trim() : null;
}

// â”€â”€â”€ SHA256-hjÃ¤lp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function sha256(value: string): string {
    return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function shortHash(value: string): string {
    return sha256(value).slice(0, 24);
}

/**
 * requirementHash: SHA256(caseId | normalizedText | documentId)
 * Inkluderar dokumentId sÃ¥ att lika formuleringar frÃ¥n olika dokument inte krockar.
 */
export function makeRequirementHash(caseId: string, normalizedText: string, documentId: string): string {
    return sha256(`${caseId}|${normalizedText}|${documentId}`);
}

// â”€â”€â”€ PipelineRun-hjÃ¤lp â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function startPipelineRun(opts: {
    runType: string;
    stageName: string;
    config?: Record<string, unknown>;
}): Promise<string> {
    const runId = `${opts.runType}_${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
    await prisma.$executeRawUnsafe(
        `INSERT INTO ingest_runs (run_id, run_type, stage_name, status, config_snapshot)
     VALUES ($1, $2, $3, 'RUNNING', $4::jsonb)
     ON CONFLICT (run_id) DO NOTHING;`,
        runId,
        opts.runType,
        opts.stageName,
        JSON.stringify(opts.config ?? {}),
    );
    return runId;
}

export async function finishPipelineRun(runId: string, processedCount: number, errorCount: number): Promise<void> {
    const status = errorCount === 0 ? 'SUCCESS' : processedCount > 0 ? 'SUCCESS' : 'FAILED';
    await prisma.$executeRawUnsafe(
        `UPDATE ingest_runs
     SET finished_at = NOW(), status = $2, processed_count = $3, error_count = $4
     WHERE run_id = $1;`,
        runId, status, processedCount, errorCount,
    );
}

export async function failPipelineRun(runId: string, error: unknown): Promise<void> {
    const msg = error instanceof Error ? error.message : String(error);
    await prisma.$executeRawUnsafe(
        `UPDATE ingest_runs SET finished_at = NOW(), status = 'FAILED', notes = $2 WHERE run_id = $1;`,
        runId, msg,
    );
}

// â”€â”€â”€ Evidence + Review Queue writer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface EvidenceInput {
    documentId: string;
    fieldName: MetadataField;
    fieldValue: string | null;
    confidence: number;
    sourceType: string;
    extractorVersion?: string;
    rawEvidence?: string;
    llmPromptHash?: string;
    llmResponse?: string;
    modelName?: string;
}

export async function writeEvidence(e: EvidenceInput): Promise<void> {
    await prisma.$executeRawUnsafe(
        `INSERT INTO "DocumentMetadataEvidence"
     (id, "documentId", "fieldName", "fieldValue", confidence, "sourceType",
      "extractorVersion", "rawEvidence", "llmPromptHash", "llmResponse", "modelName")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
        e.documentId, e.fieldName, e.fieldValue ?? null,
        e.confidence, e.sourceType, e.extractorVersion ?? '1.0',
        e.rawEvidence ?? null, e.llmPromptHash ?? null,
        e.llmResponse ?? null, e.modelName ?? null,
    );
}

export async function enqueueReview(opts: {
    documentId: string;
    queueType: 'LOW_CONFIDENCE' | 'DISAGREEMENT';
    fieldName: string;
    proposedValue: string | null;
    confidence: number | null;
    reason: string;
}): Promise<void> {
    await prisma.$executeRawUnsafe(
        `INSERT INTO "MetadataReviewQueue"
     (id, "documentId", "queueType", "fieldName", "proposedValue", confidence, reason)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6);`,
        opts.documentId, opts.queueType, opts.fieldName,
        opts.proposedValue ?? null, opts.confidence ?? null, opts.reason,
    );
}

/**
 * Skriv metadata-fÃ¤lt till DocumentRecord med confidence-skrivpolicy:
 * - Uppdaterar endast om nytt vÃ¤rde har hÃ¶gre confidence Ã¤n befintligt.
 * - Hoppar Ã¶ver LOCKED-fÃ¤lt (metadataReviewStatus = 'LOCKED').
 * - Skriver alltid evidensrad.
 * - Om under fÃ¤ltets trÃ¶skel: skickar till LOW_CONFIDENCE-kÃ¶.
 */
export async function conditionalUpdate(opts: {
    documentId: string;
    field: MetadataField;
    value: string | null;
    confidence: number;
    sourceType: string;
    extractorVersion?: string;
    rawEvidence?: string;
    llmPromptHash?: string;
    llmResponse?: string;
    modelName?: string;
    dryRun?: boolean;
}): Promise<'updated' | 'skipped_locked' | 'skipped_lower' | 'queued_low_confidence'> {
    const threshold = CONFIDENCE_THRESHOLDS[opts.field];
    // Map field names to actual DB column names
    const confidenceCol = fieldToConfidenceCol(opts.field);
    const sourceCol = fieldToSourceCol(opts.field);
    const valueCol = fieldToColumn(opts.field);

    // Always write evidence
    if (!opts.dryRun) {
        await writeEvidence({
            documentId: opts.documentId,
            fieldName: opts.field,
            fieldValue: opts.value,
            confidence: opts.confidence,
            sourceType: opts.sourceType,
            extractorVersion: opts.extractorVersion,
            rawEvidence: opts.rawEvidence,
            llmPromptHash: opts.llmPromptHash,
            llmResponse: opts.llmResponse,
            modelName: opts.modelName,
        });
    }

    // Check if LOCKED
    const doc = await prisma.$queryRawUnsafe<[{ locked: boolean; currentConfidence: number | null }]>(
        `SELECT
       ("metadataReviewStatus" = 'LOCKED') AS locked,
       "${confidenceCol}" AS "currentConfidence"
     FROM "DocumentRecord" WHERE id = $1;`,
        opts.documentId,
    );
    if (!doc[0]) return 'skipped_lower';
    if (doc[0].locked) return 'skipped_locked';

    const currentConf = doc[0].currentConfidence ?? -1;
    if (opts.confidence <= currentConf) return 'skipped_lower';

    // Under threshold: queue for review
    if (opts.confidence < threshold) {
        if (!opts.dryRun) {
            await enqueueReview({
                documentId: opts.documentId,
                queueType: 'LOW_CONFIDENCE',
                fieldName: opts.field,
                proposedValue: opts.value,
                confidence: opts.confidence,
                reason: `confidence ${opts.confidence.toFixed(2)} < threshold ${threshold}`,
            });
        }
        return 'queued_low_confidence';
    }

    if (!opts.dryRun) {
        // Special handling for municipality: also update raw/normalized columns
        if (opts.field === 'municipality') {
            const normalized = normalizeMunicipality(opts.value);
            await prisma.$executeRawUnsafe(
                `UPDATE "DocumentRecord"
         SET "municipality" = $2, "municipalityRaw" = $3, "municipalityNormalized" = $4,
             "${confidenceCol}" = $5, "${sourceCol}" = $6, "updatedAt" = NOW()
         WHERE id = $1;`,
                opts.documentId, opts.value, opts.value, normalized,
                opts.confidence, opts.sourceType,
            );
        } else {
            await prisma.$executeRawUnsafe(
                `UPDATE "DocumentRecord"
         SET "${valueCol}" = $2, "${confidenceCol}" = $3, "${sourceCol}" = $4, "updatedAt" = NOW()
         WHERE id = $1;`,
                opts.documentId, opts.value, opts.confidence, opts.sourceType,
            );
        }
    }
    return 'updated';
}

function fieldToColumn(field: MetadataField): string {
    return field; // all field names match DB column names directly
}

/** Maps field name to its confidence column in DocumentRecord */
function fieldToConfidenceCol(field: MetadataField): string {
    if (field === 'legalStatus') return 'diarieConfidence';
    return `${field}Confidence`;
}

/** Maps field name to its source column in DocumentRecord */
function fieldToSourceCol(field: MetadataField): string {
    if (field === 'legalStatus') return 'diarieSource';
    return `${field}Source`;
}

export function arg(name: string): string | undefined {
    const entry = process.argv.find((v) => v.startsWith(`--${name}=`));
    return entry ? entry.slice(name.length + 3).trim() : undefined;
}

export function flag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}


