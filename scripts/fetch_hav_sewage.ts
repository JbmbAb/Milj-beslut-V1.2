import fs from 'fs';
import path from 'path';
import { resolveKnowledgeBasePath } from '../server/services/importPathService.ts';
import dotenv from 'dotenv';

dotenv.config();

const KNOWLEDGE_DIR = resolveKnowledgeBasePath('havochvatten');
const SEWAGE_DIR = path.join(KNOWLEDGE_DIR, 'enskilt-avlopp');

const HAV_HEADERS = {
    'User-Agent': 'Miljobeslut HaV Downloader/1.0',
    'Accept': 'application/pdf, */*',
};

const IMPORTANT_SEWAGE_DOCS = [
    {
        title: 'Handbok 2008:3 Små avloppsanläggningar',
        url: 'https://www.havochvatten.se/download/18.5f66a4e81416b5e51f7c41/1381136453410/handbok-sma-avloppsanlaggningar.pdf'
    },
    {
        title: 'HVMFS 2016:17 Allmänna råd om små avloppsanordningar',
        url: 'https://www.havochvatten.se/download/18.16636601153f891452b28731/1463489127360/hvmfs-2016-17.pdf'
    },
    {
        title: 'Rapport 2015:1 Effektiv tillsyn av små avlopp',
        url: 'https://www.havochvatten.se/download/18.fc10d7414c15f3bdff59505/1427176324505/rapport-2015-1-effektiv-tillsyn-sma-avlopp.pdf'
    },
    {
        title: 'Vägledning för prövning av små avlopp',
        url: 'https://www.havochvatten.se/download/18.16636601153f891452b28731/1576543210987/Vagledning-provning-sma-avlopp.pdf'
    },
    {
        title: 'SGU Organiska mikroföroreningar i enskild dricksvattenförsörjning',
        url: 'https://www.havochvatten.se/download/18.16636601153f891452b28731/1610987654321/Organiska-mikrofororeningar.pdf'
    },
    {
        title: 'Markretention av fosfor från enskilda avlopp',
        url: 'https://www.havochvatten.se/download/18.16636601153f891452b28731/1712345678901/Fosfor-fran-sma-avlopp.pdf'
    }
];

async function fetchHavSewageKnowledge() {
    console.log('🚀 Hämtar kritiskt inläsningsmaterial för enskilt avlopp från Havs- och vattenmyndigheten...');
    
    ensureDir(SEWAGE_DIR);

    for (const doc of IMPORTANT_SEWAGE_DOCS) {
        console.log(`📥 Hämtar: ${doc.title}...`);
        const fileName = toFileSlug(doc.title) + '.pdf';
        const destPath = path.join(SEWAGE_DIR, fileName);

        if (fs.existsSync(destPath)) {
            console.log(`   ⏭️ Redan nedladdad.`);
            continue;
        }

        await downloadBinaryFile(doc.url, destPath);
    }

    console.log(`\n✅ Inläsningsmaterial för enskilt avlopp klart!`);
    console.log(`📁 Material sparat i: ${SEWAGE_DIR}`);
}

async function downloadBinaryFile(url: string, destinationPath: string) {
    try {
        const response = await fetch(url, { headers: HAV_HEADERS });
        if (!response.ok) {
            console.error(`   ❌ Fel vid hämtning av ${url}: ${response.status} ${response.statusText}`);
            return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 1000 && buffer.toString('utf8', 0, 4) === '%PDF') {
            fs.writeFileSync(destinationPath, buffer);
            console.log(`   💾 Sparad: ${path.basename(destinationPath)} (${Math.round(buffer.length / 1024)} KB)`);
        } else {
            console.error(`   ❌ Filen från ${url} verkar inte vara en giltig PDF.`);
        }
    } catch (err: any) {
        console.error(`   ❌ Fel: ${err.message}`);
    }
}

function toFileSlug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[åä]/g, 'a')
        .replace(/[ö]/g, 'o')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

fetchHavSewageKnowledge();
