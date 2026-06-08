import { FunctionDeclaration, Type } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';
import { logger } from '../../../../logger';

/**
 * searchSewageKnowledge
 * Deep search in the curated Sewage AI Data Store (Vertex AI Search).
 * Provides authoritative answers from manuals, handbooks, and specialized reports.
 */

export const searchSewageKnowledgeDeclaration: FunctionDeclaration = {
  name: 'searchSewageKnowledge',
  description: 'Söker djupt i tekniska handböcker, vägledningar och rapporter om enskilt avlopp. Använd detta för detaljerade tekniska frågor, LTAR-värden, avståndskrav enligt NFS 2016:16 och specifika reningsmetoder.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'Frågan eller ämnet att söka efter (t.ex. "dimensionering av markbädd för 8 PE" eller "krav på fosforrening i hög skyddsnivå").'
      }
    },
    required: ['query'],
  },
};

const auth = new GoogleAuth({
  scopes: 'https://www.googleapis.com/auth/cloud-platform'
});

export async function searchSewageKnowledgeHandler(args: { query: string }) {
  const { query } = args;
  
  const projectId = process.env.VERTEX_PROJECT_ID || 'miljointelligens';
  const location = 'global'; // Vertex AI Search is usually global
  const collectionId = 'default_collection';
  const dataStoreId = process.env.SEWAGE_DATA_STORE_ID || 'sewage-knowledge-store'; // Update with your actual ID

  try {
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const url = `https://discoveryengine.googleapis.com/v1/projects/${projectId}/locations/${location}/collections/${collectionId}/dataStores/${dataStoreId}/servingConfigs/default_search:search`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: query,
        pageSize: 5,
        contentSearchSpec: {
          summarySpec: {
            summaryResultCount: 3,
            includeCitations: true
          },
          snippetSpec: {
            maxSnippetCount: 3
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Vertex AI Search API error:', errorText);
      return { error: 'Kunde inte söka i kunskapsbanken just nu.' };
    }

    const data = await response.json() as any;
    
    // Process results into a format the AI can easily digest
    const results = (data.results || []).map((res: any) => {
      const doc = res.document?.derivedStructData;
      return {
        title: doc?.title || 'Okänt dokument',
        snippet: res.document?.derivedStructData?.snippets?.[0]?.snippet || '',
        link: doc?.link || '',
        source: 'Sewage Knowledge Base'
      };
    });

    const summary = data.summary?.summaryText || '';

    return {
      summary,
      authoritativeSources: results
    };

  } catch (err: any) {
    logger.error('searchSewageKnowledge error:', err);
    return { error: 'Fel vid uppslagning i avlopps-manualer.', details: err.message };
  }
}
