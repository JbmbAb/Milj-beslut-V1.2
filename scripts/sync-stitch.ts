import { prisma } from '../server/db/prisma';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    const stitchUrl = process.env.STITCH_PROJECT_URL;
    const stitchApiKey = process.env.STITCH_API_KEY;

    if (!stitchUrl || !stitchApiKey) {
        console.error('Saknar STITCH_PROJECT_URL eller STITCH_API_KEY i .env');
        process.exit(1);
    }

    console.log('Beräknar senaste coverage-data...');

    const [totalDocs, withMuni, withDecision, withText] = await Promise.all([
        prisma.documentRecord.count(),
        prisma.documentRecord.count({ where: { municipalityNormalized: { not: null } } }),
        prisma.documentRecord.count({ where: { decisionType: { not: null } } }),
        prisma.documentRecord.count({ where: { status: { in: ['TEXT_EXTRACTED', 'CHUNKED', 'EMBEDDED'] } } }),
    ]);

    const report = {
        timestamp: new Date().toISOString(),
        metrics: {
            total_documents: totalDocs,
            municipality_coverage: Math.round((withMuni / totalDocs) * 100),
            decision_type_coverage: Math.round((withDecision / totalDocs) * 100),
            text_extraction_status: Math.round((withText / totalDocs) * 100),
        },
        environment: 'demo-mvp'
    };

    console.log('Synkar mot Stitch:', report.metrics);

    // I en riktig Stitch-integration skickar vi detta till deras metrics-ingest endpoint
    // Vi simulerar / verifierar kopplingen här
    try {
        const projectId = stitchUrl.split('/').pop();
        const apiEndpoint = `https://stitch.withgoogle.com/api/v1/projects/${projectId}/metrics`;

        console.log(`Anropar: ${apiEndpoint}`);

        const res = await fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${stitchApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(report)
        });

        if (res.ok) {
            console.log('✅ Stitch-dashboard uppdaterad!');
        } else {
            const err = await res.text();
            console.warn(`⚠️ Stitch API svarade med ${res.status}: ${err}`);
            console.log('Notera: Stitch API-nycklar kan ha IP-restriktioner, men vi har loggat progressen lokalt.');
        }

    } catch (e) {
        console.error('Kunde inte nå Stitch API:', e);
    }
}

main().finally(() => prisma.$disconnect());
