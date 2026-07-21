import { json, type LoaderFunctionArgs } from '@remix-run/node';
import { Client } from 'pg';
import { DossierBuilderService } from '../../services/dossier/dossierBuilderService';
import { vertexDirigent } from '../../services/orchestrator/vertexDirigentService';
import { buildSimplePdfBuffer } from '../../server/services/pdfExportService';

export async function loader({ params, request }: LoaderFunctionArgs) {
    const propertyId = params.propertyId;
    const url = new URL(request.url);
    const format = url.searchParams.get('format');

    if (!propertyId) {
        return json({ error: 'Property ID is required' }, { status: 400 });
    }

    const decodedPropertyId = decodeURIComponent(propertyId);
    const client = new Client({ connectionString: process.env.DATABASE_URL });

    try {
        await client.connect();
        const builder = new DossierBuilderService(client);
        const payload = await builder.buildDossierPayload(decodedPropertyId);
        
        if (!payload) {
            return json({ error: 'Property not found' }, { status: 404 });
        }

        const aiResponse = await vertexDirigent.generateDossier(payload);

        // Om format=pdf efterfrågas, generera en PDF
        if (format === 'pdf') {
            const body = `
            Fastighet: ${decodedPropertyId}
            Datum: ${new Date().toLocaleDateString('sv-SE')}
            
            SAMMANFATTNING:
            ${aiResponse.summary}
            
            RISKKLASS: ${aiResponse.riskClass}
            
            MILJÖFAKTA:
            - Jordarter: ${payload.sgu.soilTypes.join(', ') || 'Okänt'}
            - Avstånd till vatten: ${payload.hydrography.distanceToSurfaceWaterMeters ? Math.round(payload.hydrography.distanceToSurfaceWaterMeters) + 'm' : 'Okänt'}
            
            REKOMMENDATIONER:
            ${aiResponse.recommendations.map(r => `- ${r.text} (${r.citation.lawChapter})`).join('\n')}
            
            Lokaliseringskarta: [Fastighetens koordinater: ${payload.geometry?.coordinates || 'Se karta i portal'}]
            `;

            const pdfBuffer = await buildSimplePdfBuffer({
                title: `Fastighetsdossier: ${decodedPropertyId}`,
                subtitle: `Miljöbedömning och lokaliseringsunderlag`,
                body: body
            });

            return new Response(pdfBuffer, {
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Disposition': `attachment; filename="dossier-${decodedPropertyId.replace(/\s+/g, '-')}.pdf"`
                }
            });
        }

        return json({
            propertyId: decodedPropertyId,
            inputData: payload,
            analysis: aiResponse
        });

    } catch (error: any) {
        console.error('Dossier API Error:', error);
        return json({ error: error.message }, { status: 500 });
    } finally {
        await client.end();
    }
}
