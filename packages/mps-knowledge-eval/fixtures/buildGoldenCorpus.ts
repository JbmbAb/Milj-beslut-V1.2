import {
  buildCorpusSnapshot,
  createStaticAuthorizedSourceCatalog,
  projectDocument,
  type AuthorizedSourceCatalog,
  type CorpusDocumentProjection,
  type CorpusSnapshot,
  type ProjectDocumentOutcome,
} from '@miljobeslut/mps-knowledge-corpus';
import type { TextExtractorPort } from '@miljobeslut/mps-text-projection';

import * as AVFALL from './real/regeringskansliet_sfs_2020_614';
import * as FMH from './real/regeringskansliet_sfs_1998_899';
import * as HVMFS from './real/hav_hvmfs_2016_17';
import * as MB from './real/regeringskansliet_sfs_1998_808';
import * as MPF from './real/regeringskansliet_sfs_2013_251';
import * as MTF from './real/regeringskansliet_sfs_2011_338';
import * as PBL from './real/regeringskansliet_sfs_2010_900';
import { REAL_REGISTRY_BINDINGS, REAL_REGISTRY_FIXTURE_ORIGIN } from './real/registryBindings';
import { SYNTHETIC_DOCUMENTS } from './syntheticCorpus';

/**
 * Builds the golden corpus deterministically: real statute excerpts (derived from governed
 * quarantine artifacts, see fixtures/real/*) + the synthetic Mora case family + adversarial
 * material, all projected against a FIXTURE catalog that mirrors the 13 real registry bindings.
 * Every skipped/rejected input is returned, never silently dropped.
 */
export interface GoldenCorpus {
  readonly catalog: AuthorizedSourceCatalog;
  readonly snapshot: CorpusSnapshot;
  /** fixture key -> content-derived document_id */
  readonly keys: Readonly<Record<string, string>>;
  readonly docs: Readonly<Record<string, CorpusDocumentProjection>>;
  readonly skipped: readonly { readonly key: string; readonly outcome: ProjectDocumentOutcome }[];
}

const REAL_MODULES = [MB, MPF, AVFALL, PBL, FMH, MTF, HVMFS];

const utf8: TextExtractorPort = {
  async extract(_source, bytes) {
    const text = new TextDecoder('utf-8').decode(bytes);
    return { text, method: 'plain_text', version: 'plain-text@fixture', succeeded: text.length > 0 };
  },
};

const failing: TextExtractorPort = {
  async extract() {
    return {
      text: '',
      method: 'pdf_parse',
      version: 'pdf-parse@fixture',
      succeeded: false,
      notes: 'pdf-parse returned no text (image-only scan)',
    };
  },
};

const empty: TextExtractorPort = {
  async extract() {
    return {
      text: '',
      method: 'html',
      version: 'html-extract@fixture',
      succeeded: true,
      notes: 'empty html text after tag stripping',
    };
  },
};

export function goldenCatalog(): AuthorizedSourceCatalog {
  return createStaticAuthorizedSourceCatalog(REAL_REGISTRY_BINDINGS, REAL_REGISTRY_FIXTURE_ORIGIN);
}

export async function buildGoldenCorpus(): Promise<GoldenCorpus> {
  const catalog = goldenCatalog();
  const docs: Record<string, CorpusDocumentProjection> = {};
  const skipped: { key: string; outcome: ProjectDocumentOutcome }[] = [];
  const enc = new TextEncoder();

  for (const m of REAL_MODULES) {
    for (const x of m.EXCERPTS) {
      const outcome = await projectDocument(
        {
          source_id: m.ORIGIN.source_id,
          expected_registry_source_content_hash: m.ORIGIN.registry_source_content_hash,
          doc_name: `${m.ORIGIN.source_id}:${x.key}`,
          mime_type: 'text/plain',
          bytes: enc.encode(x.text),
          acquisition: {
            quarantine_id: m.ORIGIN.quarantine_id,
            acquired_at: m.ORIGIN.retrieved_at,
            source_url: m.ORIGIN.source_url ?? undefined,
          },
          source_version_label: `excerpt-of:${m.ORIGIN.raw_source_content_hash.slice(0, 16)}:${x.char_range[0]}-${x.char_range[1]}`,
          // Several excerpts derive from ONE harvested page (same source_url); they are distinct
          // fixture documents, not versions of each other, so each excerpt is its own lineage.
          version_lineage_key: `${m.ORIGIN.source_id}:excerpt:${x.key}`,
        },
        { catalog, extractor: utf8 },
      );
      if (outcome.kind === 'PROJECTED') docs[x.key] = outcome.document;
      else skipped.push({ key: x.key, outcome });
    }
  }

  for (const s of SYNTHETIC_DOCUMENTS) {
    const extractor = s.extraction === 'fail' ? failing : s.extraction === 'empty' ? empty : utf8;
    const outcome = await projectDocument(
      {
        source_id: s.source_id,
        doc_name: s.doc_name,
        mime_type: s.extraction ? 'application/pdf' : 'text/plain',
        bytes: enc.encode(s.text),
        ...(s.declared_role
          ? { declared_role: s.declared_role, declared_role_reason: s.declared_role_reason }
          : {}),
        ...(s.acquired_at ? { acquisition: { acquired_at: s.acquired_at } } : {}),
        ...(s.source_version_label ? { source_version_label: s.source_version_label } : {}),
        ...(s.version_lineage_key ? { version_lineage_key: s.version_lineage_key } : {}),
      },
      { catalog, extractor },
    );
    if (outcome.kind === 'PROJECTED') docs[s.key] = outcome.document;
    else skipped.push({ key: s.key, outcome });
  }

  const snapshot = buildCorpusSnapshot(Object.values(docs), { catalog_origin: REAL_REGISTRY_FIXTURE_ORIGIN });
  const keys = Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.document_id]));
  return Object.freeze({
    catalog,
    snapshot,
    keys: Object.freeze(keys),
    docs: Object.freeze(docs),
    skipped: Object.freeze(skipped),
  });
}
