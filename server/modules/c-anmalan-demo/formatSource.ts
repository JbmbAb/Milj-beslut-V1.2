/**
 * One wording for sources, shared by the PDFs and the demo view. Pure: no Node or DOM APIs.
 */
import { PROVENANCE_LABEL, type RowProvenance } from './types';

const short = (h: string | null | undefined, n = 12) => (h ? `${h.slice(0, n)}…` : '–');

export function formatSource(p: RowProvenance): string {
  switch (p.kind) {
    case 'municipal_corpus':
      return `Källa: ${PROVENANCE_LABEL[p.kind]}, ${p.kommun}, dnr ${p.diarienummer || '–'}, dokument-SHA ${short(p.documentSha256)}, s. ${p.page}${p.verified ? '' : ' (automatiskt extraherad, ej manuellt kontrollerad)'}`;
    case 'legal_corpus':
      return `Källa: ${PROVENANCE_LABEL[p.kind]}, ${p.paragraph || '–'}, ${p.recordKey}, content_hash ${short(p.contentHash)}; ${p.caveat}`;
    case 'mimer_layer':
      return `Källa: ${PROVENANCE_LABEL[p.kind]} ${p.layer}${p.datasetVersion ? `, dataset ${p.datasetVersion}` : ''}, bundle ${short(p.bundleSha256)}; fråga: ${p.query}`;
    case 'user_input': {
      const files = p.sources?.map((f) => `${f.file} sha256 ${short(f.sha256, 8)}`).join(', ');
      return `Källa: ${PROVENANCE_LABEL[p.kind]}${files ? ` (${files})` : ''}${p.fictional ? ' – fiktiv uppgift (demo)' : ''}`;
    }
    case 'template_default':
      return `Källa: ${PROVENANCE_LABEL[p.kind]} (${p.templateId})`;
  }
}
