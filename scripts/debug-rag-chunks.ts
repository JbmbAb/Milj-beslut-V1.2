/**
 * debug-rag-chunks.ts
 * Shows what chunks are returned and their actual content.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const EMBEDDING_MODEL = 'gemini-embedding-001';
const QUERY = 'mellanlagring av avfall på platta krav lakvatten';

async function embedText(text: string): Promise<number[] | null> {
    const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text }] } }),
    });
    const payload = (await res.json()) as any;
    return payload.embedding?.values ?? null;
}

function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
    }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
    console.log('Embedding query...');
    const vec = await embedText(QUERY);
    if (!vec) { console.error('No embedding'); return; }

    console.log('\nFetching chunks with embeddings...');
    const chunks = await db.documentChunk.findMany({
        where: { embeddingJson: { not: null } },
        take: 3000,
        select: { id: true, documentId: true, chunkIndex: true, chunkText: true, embeddingJson: true },
    });
    console.log(`Total chunks with embeddings: ${chunks.length}`);

    const scored = chunks
        .map(c => ({ ...c, sim: cosine(vec, (c.embeddingJson as number[]).slice(0, vec.length)) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 5);

    console.log('\n=== TOP 5 CHUNKS ===\n');
    for (const c of scored) {
        console.log(`Document: ${c.documentId}`);
        console.log(`Similarity: ${c.sim.toFixed(4)}`);
        console.log(`Text (first 400 chars): ${String(c.chunkText).slice(0, 400)}`);
        console.log('---');
    }
}

main().catch(console.error).finally(() => db.$disconnect());
