import fs from 'fs';
import path from 'path';
import { boverketService } from '../services/boverketService';
import { resolveKnowledgeBasePath } from '../server/services/importPathService';
import dotenv from 'dotenv';

dotenv.config();
// Också kolla .env.local om den finns
if (fs.existsSync('.env.local')) {
    const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
    for (const k in envConfig) {
        process.env[k] = envConfig[k]
    }
}

const KNOWLEDGE_DIR = resolveKnowledgeBasePath('boverket');
const TERMBANK_INFO_PAGE_URL =
    'https://www.boverket.se/sv/PBL-kunskapsbanken/teman/begreppsbanken/begreppsbank-som-api/';
const TERMBANK_TECHNICAL_PDF_URL =
    'https://www.boverket.se/contentassets/ab6e12091f2b45c4a88725c0b518a57e/anvandarvillkor-och-teknisk-beskrivning.pdf';
const TERMBANK_PORTAL_URL = 'https://api-portal.boverket.se/reference#api=boverkets-api-f-r-begreppsbanken';
const FORFATTNINGAR_DIR = path.join(KNOWLEDGE_DIR, 'forfattningar');
const FORFATTNINGAR_METADATA_DIR = path.join(FORFATTNINGAR_DIR, 'metadata');
const FORFATTNINGAR_DOKUMENT_DIR = path.join(FORFATTNINGAR_DIR, 'dokument');
const FORFATTNINGAR_OVRIGA_DIR = path.join(FORFATTNINGAR_DIR, 'ovriga-dokument');
const BOVERKET_PUBLIC_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml,application/json,application/pdf;q=0.9,*/*;q=0.8',
    'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
};

if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

interface BoverketExtraDocument {
    typ?: string;
    lank?: string;
    beskrivning?: string;
    storlek?: number;
}

interface BoverketForfattning {
    id: string;
    forfattning: string;
    dokumentlank?: string;
    ovrigaDokument?: BoverketExtraDocument[];
    [key: string]: unknown;
}

async function fetchAllKnowledge() {
    console.log('🚀 Startar nedladdning av Boverkets Kunskapsbas...');

    if (!process.env.BOVERKET_API_KEY) {
        console.log('ℹ️ Ingen BOVERKET_API_KEY hittades. Testar att hämta från publika/öppna endpoints...');
    } else {
        console.log('🔑 Använder API-nyckel från miljövariabler.');
    }

    try {
        // 1. Hämta alla författningar (Metadata/Lista)
        console.log('📚 Hämtar lista över alla författningar...');
        const forfattningar = await boverketService.getForfattningar();
        fs.writeFileSync(
            path.join(KNOWLEDGE_DIR, 'forfattningssamling.json'), 
            JSON.stringify(forfattningar, null, 2)
        );
        console.log(`✅ Sparade författningslista. Hittade ${forfattningar?.length || 0} poster.`);
        await cacheAllForfattningar(Array.isArray(forfattningar) ? (forfattningar as BoverketForfattning[]) : []);

        // 2. Hämta de viktigaste författningarna direkt (t.ex. BBR)
        // OBS: Detta förutsätter att getForfattningar() returnerar en array med "bfsNummer" eller liknande.
        // För demonstration hämtar vi en känd BFS (BBR 29 - BFS 2011:6) om API:et stöder det direkt
        try {
            console.log('📖 Hämtar specifik författning (BBR - BFS 2011:6)...');
            const bbr = await boverketService.getForfattning('BFS 2011:6');
            fs.writeFileSync(
                path.join(KNOWLEDGE_DIR, 'bbr_bfs_2011_6.json'), 
                JSON.stringify(bbr, null, 2)
            );
            console.log('✅ Sparade BBR.');
        } catch {
            console.warn('⚠️ Kunde inte hämta BBR automatiskt. (Detta är normalt om endpointen returnerar 404 eller kräver exakt ID)');
        }

        // 3. Hämta Ordbok / Termbank
        console.log('📖 Hämtar Termbank (Ordbok)...');
        try {
            const termbank = await boverketService.getTermbank();
            fs.writeFileSync(
                path.join(KNOWLEDGE_DIR, 'termbank.json'), 
                JSON.stringify(termbank, null, 2)
            );
            console.log(`✅ Sparade termbank. Hittade begrepp.`);
        } catch {
            console.warn('⚠️ Kunde inte hämta Termbank-API. Sparar publik vägledningssida och teknisk beskrivning som fallback.');
            await cacheTermbankFallback();
        }

        console.log('\n🎉 Klar! All relevant data är nu cachad i:', KNOWLEDGE_DIR);
        console.log('Dessa filer kan nu läsas in direkt av Vertex AI (Dirigenten) utan att belasta nätverket.');

    } catch (error: any) {
        console.error('❌ Ett fel uppstod under hämtningen:', error.message);
    }
}

async function cacheTermbankFallback() {
    const pageResponse = await fetch(TERMBANK_INFO_PAGE_URL, {
        headers: BOVERKET_PUBLIC_HEADERS,
    });
    if (!pageResponse.ok) {
        throw new Error(`Kunde inte hämta publik termbanksida: ${pageResponse.status} ${pageResponse.statusText}`);
    }

    fs.writeFileSync(
        path.join(KNOWLEDGE_DIR, 'termbank-api-info.html'),
        await pageResponse.text(),
        'utf8',
    );

    const pdfResponse = await fetch(TERMBANK_TECHNICAL_PDF_URL, {
        headers: BOVERKET_PUBLIC_HEADERS,
    });
    if (!pdfResponse.ok) {
        throw new Error(`Kunde inte hämta teknisk PDF för termbanken: ${pdfResponse.status} ${pdfResponse.statusText}`);
    }

    fs.writeFileSync(
        path.join(KNOWLEDGE_DIR, 'termbank-teknisk-beskrivning.pdf'),
        Buffer.from(await pdfResponse.arrayBuffer()),
    );

    fs.writeFileSync(
        path.join(KNOWLEDGE_DIR, 'termbank-source.json'),
        JSON.stringify(
            {
                mode: 'public-fallback',
                infoPageUrl: TERMBANK_INFO_PAGE_URL,
                technicalPdfUrl: TERMBANK_TECHNICAL_PDF_URL,
                developerPortalUrl: TERMBANK_PORTAL_URL,
                fetchedAt: new Date().toISOString(),
            },
            null,
            2,
        ),
        'utf8',
    );

    console.log('✅ Sparade publik termbanksida, teknisk beskrivning och källmetadata.');
}

async function cacheAllForfattningar(forfattningar: readonly BoverketForfattning[]) {
    resetDir(FORFATTNINGAR_DIR);
    ensureDir(FORFATTNINGAR_METADATA_DIR);
    ensureDir(FORFATTNINGAR_DOKUMENT_DIR);
    ensureDir(FORFATTNINGAR_OVRIGA_DIR);

    console.log(`📥 Hämtar ${forfattningar.length} författningar och länkade rekommendationer/bilagor...`);

    const concurrency = 6;
    const summary = {
        metadataFiles: 0,
        primaryDocuments: 0,
        extraDocuments: 0,
    };

    for (let start = 0; start < forfattningar.length; start += concurrency) {
        const batch = forfattningar.slice(start, start + concurrency);
        await Promise.all(
            batch.map(async (forfattning) => {
                await cacheForfattning(forfattning, summary);
            }),
        );
    }

    fs.writeFileSync(
        path.join(FORFATTNINGAR_DIR, 'manifest.json'),
        JSON.stringify(
            {
                fetchedAt: new Date().toISOString(),
                totalForfattningar: forfattningar.length,
                ...summary,
            },
            null,
            2,
        ),
        'utf8',
    );

    console.log(
        `✅ Sparade ${summary.metadataFiles} metadatafiler, ${summary.primaryDocuments} huvudfiler och ${summary.extraDocuments} extra rekommendations-/bilagefiler.`,
    );
}

async function cacheForfattning(forfattning: BoverketForfattning, summary: {
    metadataFiles: number;
    primaryDocuments: number;
    extraDocuments: number;
}) {
    const slug = toFileSlug(forfattning.id || forfattning.forfattning);
    fs.writeFileSync(
        path.join(FORFATTNINGAR_METADATA_DIR, `${slug}.json`),
        JSON.stringify(forfattning, null, 2),
        'utf8',
    );
    summary.metadataFiles += 1;

    if (forfattning.dokumentlank) {
        const fileName = `${slug}${inferExtensionFromUrl(forfattning.dokumentlank)}`;
        await downloadBinaryFile(
            forfattning.dokumentlank,
            path.join(FORFATTNINGAR_DOKUMENT_DIR, fileName),
        );
        summary.primaryDocuments += 1;
    }

    const extras = Array.isArray(forfattning.ovrigaDokument) ? forfattning.ovrigaDokument : [];
    for (const [index, document] of extras.entries()) {
        if (!document.lank) {
            continue;
        }

        const descriptor = toFileSlug(document.typ || document.beskrivning || `extra-${index + 1}`);
        const fileName = `${slug}__${String(index + 1).padStart(2, '0')}__${descriptor}${inferExtensionFromUrl(document.lank)}`;
        await downloadBinaryFile(
            document.lank,
            path.join(FORFATTNINGAR_OVRIGA_DIR, fileName),
        );
        summary.extraDocuments += 1;
    }
}

async function downloadBinaryFile(url: string, destinationPath: string) {
    const response = await fetch(url, {
        headers: BOVERKET_PUBLIC_HEADERS,
    });

    if (!response.ok) {
        throw new Error(`Kunde inte hämta ${url}: ${response.status} ${response.statusText}`);
    }

    fs.writeFileSync(destinationPath, Buffer.from(await response.arrayBuffer()));
}

function inferExtensionFromUrl(url: string): string {
    const cleanUrl = url.split('?')[0] || url;
    const extension = path.extname(cleanUrl).toLowerCase();
    return extension || '.bin';
}

function toFileSlug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function resetDir(dirPath: string) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    fs.mkdirSync(dirPath, { recursive: true });
}

fetchAllKnowledge();
