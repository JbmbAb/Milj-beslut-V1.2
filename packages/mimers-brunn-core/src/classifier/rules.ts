/**

 * Deterministic classification rules for Master Archive paths.

 * Highest confidence matching rule wins.

 */

import type { PathFingerprint } from './ClassifierArtifact';



export type ClassificationRule = {

  readonly id: string;

  readonly test: (fp: PathFingerprint) => boolean;

  readonly predicted_provider: string;

  readonly predicted_dataset: string;

  /** Path relative to GEO_Master_Archive root. */

  readonly predicted_target: string;

  readonly confidence: number;

  readonly reasoning: string;

};



function nameMatch(fp: PathFingerprint, re: RegExp): boolean {

  return re.test(fp.basename) || re.test(fp.rel_path);

}



function hasExt(fp: PathFingerprint, ext: string, min = 1): boolean {

  return (fp.ext_histogram[ext] ?? 0) >= min;

}



function urlHost(fp: PathFingerprint, host: string): boolean {

  return fp.url_signals.some((u) => u.toLowerCase().includes(host.toLowerCase()));

}



/**

 * Rules for leftover migration / ingest dumps under Documents.

 * Directory identity beats URL signals (avoid curated-downloads → Riksdagen via SFS links).

 */

export const DOCUMENT_INGEST_RULES: readonly ClassificationRule[] = [

  {

    id: 'domstol_history',

    test: (fp) => nameMatch(fp, /domstol-history/i),

    predicted_provider: 'Domstolsverket',

    predicted_dataset: 'domstol-history',

    predicted_target: 'Documents/Sources/Domstolsverket/from_classifier/domstol-history',

    confidence: 0.995,

    reasoning: 'Directory name domstol-history + court page/json corpus layout.',

  },

  {

    id: 'domstol_rss',

    test: (fp) => nameMatch(fp, /domstol-rss/i),

    predicted_provider: 'Domstolsverket',

    predicted_dataset: 'domstol-rss',

    predicted_target: 'Documents/Sources/Domstolsverket/from_classifier/domstol-rss',

    confidence: 0.99,

    reasoning: 'Directory name domstol-rss with feed/HTML pages.',

  },

  {

    id: 'mmd_corpus',

    test: (fp) => nameMatch(fp, /(^|\/)mmd-corpus(\/|$)/i),

    predicted_provider: 'Domstolsverket',

    predicted_dataset: 'mmd-corpus',

    predicted_target: 'Documents/Sources/Domstolsverket/from_classifier/mmd-corpus',

    confidence: 0.99,

    reasoning: 'MMD (Mark- och miljödomstolen) corpus directory.',

  },

  {

    id: 'mod_corpus',

    test: (fp) => nameMatch(fp, /(^|\/)mod-corpus(\/|$)/i),

    predicted_provider: 'Domstolsverket',

    predicted_dataset: 'mod-corpus',

    predicted_target: 'Documents/Sources/Domstolsverket/from_classifier/mod-corpus',

    confidence: 0.99,

    reasoning: 'MOD (Mark- och miljööverdomstolen) corpus directory.',

  },

  {

    id: 'lst_corpus',

    test: (fp) => nameMatch(fp, /lansstyrelser-corpus|länsstyrelser-corpus/i),

    predicted_provider: 'LST',

    predicted_dataset: 'lansstyrelser-corpus',

    predicted_target: 'Documents/Sources/Legal/from_classifier/lansstyrelser-corpus',

    confidence: 0.99,

    reasoning: 'Länsstyrelser corpus directory name.',

  },

  {

    id: 'boverket',

    test: (fp) => nameMatch(fp, /(^|\/)boverket(\/|$)/i) || urlHost(fp, 'boverket.se'),

    predicted_provider: 'Boverket',

    predicted_dataset: 'boverket',

    predicted_target: 'Documents/Sources/Boverket/from_classifier/boverket',

    confidence: 0.995,

    reasoning: 'Directory/provider name Boverket.',

  },

  {

    id: 'naturvardsverket_docs',

    test: (fp) =>

      nameMatch(fp, /(^|\/)naturvardsverket(\/|$)/i) || urlHost(fp, 'naturvardsverket.se'),

    predicted_provider: 'Naturvardsverket',

    predicted_dataset: 'naturvardsverket-docs',

    predicted_target: 'Documents/Sources/Naturvardsverket/from_classifier/naturvardsverket',

    confidence: 0.99,

    reasoning: 'Naturvårdsverket document bucket (not Data geodata).',

  },

  {

    id: 'curated_downloads_mixed',

    test: (fp) => nameMatch(fp, /curated-downloads/i),

    predicted_provider: 'Legal',

    predicted_dataset: 'curated-downloads',

    predicted_target: 'Documents/Sources/Legal/from_classifier/curated-downloads',

    confidence: 0.86,

    reasoning:

      'Curated HTML downloads with mixed authority signals (Riksdagen/SFS/sewage) — HITL split.',

  },

  {

    id: 'riksdagen_foundation',

    test: (fp) => nameMatch(fp, /foundation-sources/i),

    predicted_provider: 'Riksdagen',

    predicted_dataset: 'foundation-sources',

    predicted_target: 'Documents/Sources/Riksdagen/from_classifier/foundation-sources',

    confidence: 0.92,

    reasoning: 'Directory foundation-sources → Riksdagen; stub folders stay HITL.',

  },

  {

    id: 'open_source_sweep',

    test: (fp) => nameMatch(fp, /open-source-sweep/i),

    predicted_provider: 'UNKNOWN',

    predicted_dataset: 'open-source-sweep',

    predicted_target: '_quarantine/SAN-classifier-low/open-source-sweep',

    confidence: 0.4,

    reasoning: 'Undifferentiated open-source sweep stub — quarantine for review.',

  },

  {

    id: 'legal_parent_bucket',

    test: (fp) =>

      /(^|\/)legal$/i.test(fp.basename)

      && fp.parent_dirs.some((d) => /_migration_from_D|D_ingest_arkiv/i.test(d)),

    predicted_provider: 'Legal',

    predicted_dataset: 'legal-parent',

    predicted_target: 'Documents/Sources/Legal/from_classifier/legal-parent',

    confidence: 0.7,

    reasoning: 'Parent legal/ residual — classify children; do not auto-move parent.',

  },

  {

    id: 'domstol_generic_html',

    test: (fp) =>

      nameMatch(fp, /domstol/i) && (hasExt(fp, '.html', 10) || hasExt(fp, '.json', 50)),

    predicted_provider: 'Domstolsverket',

    predicted_dataset: 'domstol-corpus',

    predicted_target: 'Documents/Sources/Domstolsverket/from_classifier/domstol-corpus',

    confidence: 0.88,

    reasoning: 'Generic domstol path with large HTML/JSON page set.',

  },

];


