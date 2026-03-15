/**
 * demo-rag-checklist.ts
 *
 * Demo: End-to-end RAG Checklist Extraction
 *
 * 1. Takes a user query + activity code (e.g. "90.30") 
 * 2. Embeds the query via Gemini embeddings
 * 3. Performs vector similarity search against DocumentChunk table (pgvector)
 * 4. Sends top relevant chunks to Gemini 2.5 Flash for structured extraction
 * 5. Stores RequirementCase, RequirementRecord, RequirementCitation in DB
 * 6. Prints a formatted compliance checklist to console
 *
 * Usage:
 *   npx tsx scripts/demo-rag-checklist.ts
 */

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const db = new PrismaClient();

// ── Config ────────────────────────────────────────────────────────
const PROJECT_ID = 'cmm4yrse10004cunkvow2wny6'; // ADMIN-INDEX-TEST project
const ORGANISATION_ID = 'cmm4xvu980000cuh4vj0usz09';
const ACTIVITY_CODE = '90.30';
const QUERY = 'mellanlagring av avfall på platta krav och villkor lakvatten dagvatten';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
const EMBEDDING_DIM = 768;
const TOP_K = 12;
// ─────────────────────────────────────────────────────────────────

async function embedText(text: string): Promise<number[] | null> {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY saknas i .env');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text: text.slice(0, 8000) }] },
        }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Embedding API fel ${res.status}: ${err.slice(0, 300)}`);
    }
    const payload = (await res.json()) as { embedding?: { values?: number[] } };
    const values = payload.embedding?.values;
    if (!values || values.length === 0) return null;
    return values.slice(0, EMBEDDING_DIM);
}

async function geminiGenerate(prompt: string): Promise<string | null> {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_FLASH_MODEL}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
        }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function semanticSearch(queryVec: number[]): Promise<any[]> {
    // Check if pgvector column is available
    const hasVectorCol = await db.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'DocumentChunk' AND column_name = 'embeddingVector'
    ) AS exists
  `;

    if (hasVectorCol[0]?.exists) {
        const literal = `[${queryVec.join(',')}]`;
        const rows = await db.$queryRawUnsafe<any[]>(`
      SELECT c.id, c."documentId", c."chunkIndex", c."chunkText",
             1 - (c."embeddingVector" <=> '${literal}'::vector) AS similarity
      FROM "DocumentChunk" c
      WHERE c."embeddingVector" IS NOT NULL
      ORDER BY c."embeddingVector" <=> '${literal}'::vector
      LIMIT ${TOP_K}
    `);
        return rows;
    }

    // JSON fallback: cosine similarity in JS
    console.warn('[demo] pgvector ej tillgängligt – faller tillbaka på JSON-cosine');
    const chunks = await db.documentChunk.findMany({
        where: { embeddingJson: { not: null } },
        take: 2000,
        select: { id: true, documentId: true, chunkIndex: true, chunkText: true, embeddingJson: true },
    });

    function cosine(a: number[], b: number[]): number {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
            dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
        }
        return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
    }

    return chunks
        .map(c => ({
            ...c,
            similarity: cosine(queryVec, (c.embeddingJson as number[]).slice(0, queryVec.length)),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, TOP_K);
}

interface ExtractedReq {
    documentId: string;
    category: string;
    subcategory: string;
    requirementTextQuote: string;
    interpretedRequirement: string;
    level: 'mandatory' | 'recommended' | 'conditional';
    legalReference: string | null;
}

async function aiExtract(chunks: any[]): Promise<ExtractedReq[]> {
    const combined = chunks.map((c, i) => {
        const text = String(c.chunkText || '').slice(0, 700);
        return `=== FRAGMENT ${i + 1} ===\ndocumentId: "${c.documentId}"\nLikhet med sökning: ${Number(c.similarity).toFixed(3)}\nBeslutstext:\n${text}`;
    }).join('\n\n');

    const prompt = `Du är expert på svensk miljörätt. Nedanstående textfragment är hämtade från kommunala tillsynsbeslut och anmälningsärenden om mellanlagring av avfall (verksamhetskod ${ACTIVITY_CODE}).

Din uppgift: Identifiera ALLA krav, skyldigheter och villkor i texten. Leta särskilt efter svenska signalord som: ska, måste, är skyldigt, kräver, ska säkerställas, ska vidtas, ska dokumenteras, förbjudet att, är tillåtet att.

BESLUTSFRAGMENT:
${combined}

Returnera ett JSON-array. Börja DIREKT med [ utan markdown. Varje objekt ska ha exakt dessa fält:
{
  "documentId": "kopiera documentId från FRAGMENT-headern",
  "category": "ett av: Lakvatten, Dagvatten, Egenkontroll, Konstruktion, Avfall, Brandskydd, Buller, Övrigt",
  "subcategory": "specifik underkategori",
  "requirementTextQuote": "exakt citat ur texten, max 250 tecken",
  "interpretedRequirement": "ditt professionella tolkningssvar på svenska",
  "level": "mandatory",
  "legalReference": "lagparagraf om nämns, annars null"
}

Skapa ETT objekt per krav. Returnera minst ett krav per fragment om möjligt.`;

    const raw = await geminiGenerate(prompt);
    if (!raw) { console.warn('[aiExtract] Inget svar från Gemini'); return []; }

    // Try multiple JSON extraction strategies
    try {
        // Strategy 1: Find array anywhere in response
        const arrayMatch = raw.match(/\[[\s\S]*\]/);
        if (arrayMatch) return JSON.parse(arrayMatch[0]);
        // Strategy 2: If single object returned without array
        const objMatch = raw.match(/\{[\s\S]*\}/);
        if (objMatch) return [JSON.parse(objMatch[0])];
    } catch {
        // ignore
    }
    console.warn('[aiExtract] Kunde inte parsa JSON. Råsvar (1000 tecken):');
    console.warn(raw.slice(0, 1000));
    return [];
}


async function persist(reqs: ExtractedReq[]): Promise<{ cases: number; records: number; citations: number }> {
    let casesN = 0, recordsN = 0, citationsN = 0;
    const caseCache = new Map<string, string>();

    for (const req of reqs) {
        const docId = req.documentId;
        const doc = await db.documentRecord.findUnique({ where: { id: docId } });
        if (!doc) {
            console.warn(`  [skip] Dokument ${docId} finns ej i DocumentRecord`);
            continue;
        }

        // Upsert RequirementCase (one per document)
        let caseId = caseCache.get(docId);
        if (!caseId) {
            const caseKey = `rag_demo_${docId}`;
            const existing = await db.requirementCase.findUnique({ where: { caseKey } });
            if (existing) {
                caseId = existing.id;
            } else {
                const created = await db.requirementCase.create({
                    data: {
                        caseKey,
                        projectId: PROJECT_ID,
                        documentId: docId,
                        organisationId: ORGANISATION_ID,
                        municipality: doc.municipality || 'Okänd',
                        sourceFile: doc.diskName,
                        sourceSubject: doc.subject || null,
                        documentType: 'BESLUT',
                    },
                });
                caseId = created.id;
                casesN++;
            }
            caseCache.set(docId, caseId);
        }

        // Create RequirementRecord
        const requirementCode = `RAG_${activityShort()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
        const record = await db.requirementRecord.create({
            data: {
                requirementCode,
                caseId,
                documentId: docId,
                projectId: PROJECT_ID,
                sourceType: 'RAG_EXTRACTED',
                category: req.category || 'Övrigt',
                subcategory: req.subcategory || 'Generellt',
                requirementTextQuote: req.requirementTextQuote || '',
                interpretedRequirement: req.interpretedRequirement || '',
                level: req.level || 'mandatory',
                legalReference: req.legalReference || null,
            },
        });
        recordsN++;

        // Create RequirementCitation
        await db.requirementCitation.create({
            data: {
                citationCode: `CIT_${requirementCode}`,
                requirementId: record.id,
                caseId,
                documentId: docId,
                quoteText: req.requirementTextQuote || '',
                extractor: `Gemini-${GEMINI_FLASH_MODEL}`,
            },
        });
        citationsN++;
    }
    return { cases: casesN, records: recordsN, citations: citationsN };
}

function activityShort() { return ACTIVITY_CODE.replace('.', ''); }

function printChecklist(reqs: ExtractedReq[]) {
    const cats = new Map<string, ExtractedReq[]>();
    for (const r of reqs) {
        if (!cats.has(r.category)) cats.set(r.category, []);
        cats.get(r.category)!.push(r);
    }
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`  KRAVCHECKLISTA FÖR VERKSAMHETSKOD ${ACTIVITY_CODE}`);
    console.log(`  Genererad: ${new Date().toLocaleString('sv-SE')}`);
    console.log('══════════════════════════════════════════════════════════════\n');
    for (const [cat, items] of cats) {
        console.log(`▸ ${cat.toUpperCase()} (${items.length} krav)`);
        for (const item of items) {
            const lvl = item.level === 'mandatory' ? '🔴 OBLIGATORISK' : item.level === 'recommended' ? '🟡 REKOMMENDERAD' : '🔵 VILLKORAD';
            console.log(`  ${lvl} — ${item.interpretedRequirement}`);
            if (item.legalReference) console.log(`     📜 Lagstöd: ${item.legalReference}`);
        }
        console.log();
    }
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
    console.log(`\n[demo] Startar RAG-extraktion för verksamhetskod ${ACTIVITY_CODE}...`);
    console.log(`[demo] Query: "${QUERY}"\n`);

    console.log('[1/4] Genererar embedding via Gemini...');
    const vec = await embedText(QUERY);
    if (!vec) throw new Error('Embedding misslyckades – kontrollera GEMINI_API_KEY');
    console.log(`      ✓ Vektor: ${vec.length} dimensioner`);

    console.log(`[2/4] Söker bland ${TOP_K} mest relevanta chunks i pgvector...`);
    const hits = await semanticSearch(vec);
    console.log(`      ✓ Hittade ${hits.length} chunk-träffar`);
    if (hits.length === 0) { console.log('      ⚠ Inga träffar – avbryter.'); return; }

    const uniqueDocs = [...new Set(hits.map(h => h.documentId))];
    console.log(`      ✓ Från ${uniqueDocs.length} unika dokument`);

    console.log('[3/4] Skickar till Gemini för strukturerad kravextraktion...');
    const reqs = await aiExtract(hits);
    console.log(`      ✓ Extraherade ${reqs.length} lagkrav\n`);

    if (reqs.length > 0) {
        console.log('[4/4] Sparar i databasen (RequirementCase + RequirementRecord + Citation)...');
        const stored = await persist(reqs);
        console.log(`      ✓ Ärenden:     ${stored.cases} skapade`);
        console.log(`      ✓ Krav:        ${stored.records} skapade`);
        console.log(`      ✓ Citeringar:  ${stored.citations} skapade`);

        printChecklist(reqs);
    } else {
        console.log('[4/4] Inga krav att spara.\n');
        console.log('Råsvar från AI:', reqs);
    }
}

main().catch(console.error).finally(() => db.$disconnect());
