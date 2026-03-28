const fs = require('fs');
const path = require('path');

const mvpApiFile = path.join(__dirname, 'server', 'mvpApi.express.ts');
let mvpCode = fs.readFileSync(mvpApiFile, 'utf8');

// 1. Replace import { demoSearch, getRagCitations } from './services/demoSearchService';
const importTarget = "import { demoSearch, getRagCitations } from './services/demoSearchService';";
const ragImplementation = `import { runSearchQuery } from './services/searchService';

async function getRagCitations(input: {
    projectId: string;
    userId: string;
    query: string;
    topK?: number;
}) {
    const raw = await runSearchQuery({
        ...input,
        mode: 'hybrid',
        topK: input.topK || 5,
        strictEvidence: false,
    });
    
    const docIds = raw.results.map(r => r.documentId);
    const metaRows = docIds.length > 0
        ? await prisma.documentRecord.findMany({
            where: { id: { in: docIds } },
            select: { id: true, municipalityNormalized: true },
        })
        : [];
    const metaByDocId = new Map(metaRows.map(r => [r.id, r]));

    return raw.results.map(r => ({
        source: \`DocumentRecord:\${r.documentId}\`,
        snippet: (r.snippet || r.citations[0]?.quote || '').slice(0, 300),
        municipality: metaByDocId.get(r.documentId)?.municipalityNormalized || r.metadata.municipality || null,
        documentId: r.documentId,
    }));
}`;
mvpCode = mvpCode.replace(importTarget, ragImplementation);

// 2. Remove DEMO ENDPOINT GET /api/v1/projects
const demoProjectsRegex = /\/\/ ─── PUBLIC DEMO ENDPOINT: GET \/api\/v1\/projects ──────────────────────────[\s\S]*?router\.get\('\/api\/v1\/projects', async \(req, res\) => \{[\s\S]*?\}\);/g;
mvpCode = mvpCode.replace(demoProjectsRegex, '');

// 3. Remove DEMO ENDPOINT 1
const demoSearchRegex = /\/\/ ─── DEMO ENDPOINT 1: GET \/api\/v1\/projects\/:id\/search ─────────────────────[\s\S]*?router\.get\('\/api\/v1\/projects\/:id\/search', requireMvpAuth, mvpRateLimit, async \(req, res\) => \{[\s\S]*?\}\);/g;
mvpCode = mvpCode.replace(demoSearchRegex, '');

// 4. Remove __disabled-demo-project__ branch
const disabledBranchRegex = /\} else if \(projectId === '__disabled-demo-project__'\) \{[\s\S]*?\} else if/g;
mvpCode = mvpCode.replace(disabledBranchRegex, '} else if');

fs.writeFileSync(mvpApiFile, mvpCode);
console.log('Fixed mvpApi.express.ts');

const lantmaterietFile = path.join(__dirname, 'server', 'services', 'lantmaterietService.ts');
let lantmaterietCode = fs.readFileSync(lantmaterietFile, 'utf8');
const mockRegex = /\s*\/\/ --- MOCK INJECTION ---[\s\S]*?\/\/ --- END MOCK ---/g;
lantmaterietCode = lantmaterietCode.replace(mockRegex, '');
fs.writeFileSync(lantmaterietFile, lantmaterietCode);
console.log('Fixed lantmaterietService.ts');

const markCoverFile = path.join(__dirname, 'server', 'services', 'markCoverService.ts');
let markCoverCode = fs.readFileSync(markCoverFile, 'utf8');
const markMockRegex = /\s*\/\/ 3\. Synthetic demo data \(always works\)[\s\S]*?return \{[\s\S]*?areaSqMt: fallbackArea,\n    \};/g;
markCoverCode = markCoverCode.replace(markMockRegex, `
  throw new Error("Alla NMD API-anrop misslyckades. Kan ej ta fram markklassificering för angiven geometri.");`);
fs.writeFileSync(markCoverFile, markCoverCode);
console.log('Fixed markCoverService.ts');

const permitAdapterFile = path.join(__dirname, 'server', 'services', 'permitAuthorityAdapter.ts');
let permitAdapterCode = fs.readFileSync(permitAdapterFile, 'utf8');
permitAdapterCode = permitAdapterCode.replace(/\| 'MOCK_QUEUED'/g, '');
permitAdapterCode = permitAdapterCode.replace(/providerMode: 'mock' \| 'external'/g, "providerMode: 'external'");
const submitPermitMockRegex = /if \(true\) \{ \/\/ Forcing mock path for MVP[\s\S]*?return \{[\s\S]*?status: 'MOCK_QUEUED',[\s\S]*?\};[\s\S]*?\} else \{/g;
permitAdapterCode = permitAdapterCode.replace(submitPermitMockRegex, '');
permitAdapterCode = permitAdapterCode.replace(/\} \/\/ end forcing/g, '');
fs.writeFileSync(permitAdapterFile, permitAdapterCode);
console.log('Fixed permitAuthorityAdapter.ts');

const muniFile = path.join(__dirname, 'server', 'services', 'municipalityService.ts');
let muniCode = fs.readFileSync(muniFile, 'utf8');
muniCode = muniCode.replace(/const _MOCK_PROFILES[\s\S]*?\};\n/g, '');
muniCode = muniCode.replace(/const mockData = _MOCK_PROFILES\[normalized\] \|\| \{\};\n/g, '');
muniCode = muniCode.replace(/\.\.\.mockData,/g, '');
fs.writeFileSync(muniFile, muniCode);
console.log('Fixed municipalityService.ts');
