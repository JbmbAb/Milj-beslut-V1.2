/**
 * Demo RAG evaluation run (no live Vertex required).
 * Usage: npm run rag:eval:demo
 */
import { evaluateRagRuns } from '../../server/services/ragEvalService';

const cases = [
  {
    query: 'Vilket avstånd krävs till vattendrag?',
    relevantIds: ['chunk-water-1', 'doc-avlopp'],
    goldKeywords: ['vatten', 'meter', 'avlopp'],
  },
  {
    query: 'Finns Natura 2000 på platsen?',
    relevantIds: ['doc-natura'],
    goldKeywords: ['natura', 'skydd'],
  },
  {
    query: 'Vilken GIS-källa används för fastighetsgränser?',
    relevantIds: ['doc-property', 'chunk-lm'],
    goldKeywords: ['fastighet', 'postgis'],
  },
];

const runs = [
  {
    answer: 'Avstånd till vatten för avlopp bedöms i meter utifrån GIS.',
    sources: [{ chunkId: 'chunk-water-1', documentId: 'doc-avlopp' }],
    cacheHit: true,
  },
  {
    answer: 'Natura 2000-skydd kontrolleras i lokal PostGIS.',
    sources: [{ documentId: 'doc-natura' }],
    cacheHit: false,
  },
  {
    answer: 'Fastighetsgränser hämtas från PostGIS property_unit.',
    sources: [{ documentId: 'doc-property', chunkId: 'chunk-lm' }],
    cacheHit: true,
  },
];

const metrics = evaluateRagRuns(cases, runs);
console.log(JSON.stringify(metrics, null, 2));
console.log(
  `[rag-eval] precision=${metrics.precision.toFixed(3)} recall=${metrics.recall.toFixed(3)} ` +
    `faithfulness=${metrics.faithfulness.toFixed(3)} citations=${metrics.citationAccuracy.toFixed(3)} ` +
    `cacheHit=${metrics.embeddingCacheHitRate.toFixed(3)}`,
);
