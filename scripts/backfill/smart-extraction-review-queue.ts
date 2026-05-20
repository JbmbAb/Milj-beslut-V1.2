/**
 * smart-extraction-review-queue.ts
 * "Premium"-strategi: Försök extrahera metadata direkt från dokumentet med Gemini 1.5 Flash (Vision).
 * Om konfidensen är låg, markera för manuell granskning eller eskalera.
 * 
 * Kör: npx tsx scripts/backfill/smart-extraction-review-queue.ts [--limit=50] [--dry-run]
 */
import 'dotenv/config';
import { prisma } from '../../server/db/prisma';
import fs from 'node:fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
    conditionalUpdate,
    arg,
    flag,
    MetadataField
} from './_shared';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// Vi använder Flash som standard för att spara pengar, den är multimodal!
const visionModel = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" }
});

async function main() {
    const limit = Number(arg('limit') || 50);
    const dryRun = flag('dry-run');

    const reviewItems = await prisma.metadataReviewQueue.findMany({
        where: { status: 'OPEN' },
        select: { id: true, documentId: true, fieldName: true },
        take: limit,
        orderBy: { createdAt: 'desc' },
    });

    console.error(`Starting SMART extraction for ${reviewItems.length} items (limit ${limit}, dryRun ${dryRun})`);

    for (const item of reviewItems) {
        const doc = await prisma.documentRecord.findUnique({
            where: { id: item.documentId },
            select: { id: true, absolutePath: true, originalName: true }
        });

        if (!doc || !doc.absolutePath) {
            console.error(`SKIP: Document not found or no path for ${item.documentId}`);
            continue;
        }

        try {
            if (dryRun) {
                console.error(`DRY-RUN: Would process ${doc.originalName}`);
                continue;
            }

            console.error(`PROCESSING: ${doc.originalName} via Gemini Flash Vision...`);

            const fileBuffer = await fs.readFile(doc.absolutePath);
            const mimeType = doc.absolutePath.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

            const prompt = `
                Du är en expert på svenska myndighetsdokument inom miljöområdet.
                Analysera bifogat dokument och extrahera följande metadata:
                - municipality (Kommunnamn, t.ex. "Nacka")
                - legalStatus (Diarienummer, t.ex. "2024-123")
                - decisionType (Beslutstyp: "Beslut", "Anmälan", "Tillsyn", "Föreläggande")
                - activityCode (Verksamhetskod, t.ex. "90.40")
                - wasteType (Typ av avfall som nämns)

                Svara i JSON-format:
                {
                  "municipality": { "value": string, "confidence": number (0-1) },
                  "legalStatus": { "value": string, "confidence": number (0-1) },
                  "decisionType": { "value": string, "confidence": number (0-1) },
                  "activityCode": { "value": string, "confidence": number (0-1) },
                  "wasteType": { "value": string, "confidence": number (0-1) }
                }
            `;

            const result = await visionModel.generateContent([
                prompt,
                {
                    inlineData: {
                        data: fileBuffer.toString('base64'),
                        mimeType
                    }
                }
            ]);

            const responseText = result.response.text();
            console.error(`RAW RESPONSE: ${responseText}`);
            const extraction = JSON.parse(responseText);

            // Uppdatera fält i databasen via vår delade logik
            const fields: MetadataField[] = ['municipality', 'legalStatus', 'decisionType', 'activityCode', 'wasteType'];
            let anySuccess = false;

            for (const field of fields) {
                const data = extraction[field];
                if (data && data.value) {
                    console.error(`FIELD ${field}: ${data.value} (conf: ${data.confidence})`);
                    const updateStatus = await conditionalUpdate({
                        documentId: doc.id,
                        field: field,
                        value: data.value,
                        confidence: data.confidence,
                        sourceType: 'flash_vision_smart',
                        modelName: 'gemini-2.5-flash',
                        dryRun: false
                    });

                    console.error(`  -> Update status: ${updateStatus}`);
                    if (updateStatus === 'updated' || updateStatus === 'queued_low_confidence') {
                        anySuccess = true;
                    }
                }
            }

            if (anySuccess) {
                // Om vi lyckades med något, stäng ärendet i kön
                await prisma.metadataReviewQueue.update({
                    where: { id: item.id },
                    data: { status: 'RESOLVED' }
                });
                console.error(`OK: Resolved ${doc.id}`);
            }

        } catch (e) {
            console.error(`ERROR: Failed to process ${doc.id}:`, e);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
