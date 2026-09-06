/**
 * K2.2 — LOCAL corpus-expansion runner over the governed quarantine.
 *
 * READ-ONLY with respect to everything governed: it reads `.quarantine` objects and download
 * manifests, verifies the signed source registry through the server adapter, projects every
 * object through the knowledge plane (TEXT-L1 -> classification -> registered chunk policy ->
 * materialization identity -> provenance chain), builds the DISPOSABLE index read model in
 * memory with the fixture embedding, verifies it against the corpus, calibrates the abstention
 * threshold, runs a few probe queries for observability (resolved against the governed corpus),
 * and writes ONE JSON report to `--out`.
 *
 * No database, no network, no signing, no attestation, no write into `.quarantine`, no change
 * of authority: a source that is not in the verified registry is SKIPPED and reported as
 * SOURCE_AUTHORITY_REQUIRED, never admitted; an empty or unverifiable registry aborts the run.
 *
 * Usage (the public trusted keyring is required — an unverified registry is not a registry):
 *   SOURCE_REGISTRY_TRUSTED_KEYS_FILE=<public keyring json> npx tsx scripts/knowledge/run-corpus-expansion.ts \
 *     [--quarantine .quarantine] [--out <dir>] [--limit N] [--source <source_id>]... \
 *     [--previous <earlier report.json>] [--registry <path>] [--embedding hashed:<dims> | exact]
 *
 * --embedding (default hashed:1024): the FIXTURE embedding's mode. `hashed:<dims>` has fixed
 * dimensions like a production provider and scales to the whole quarantine; `exact` (one dense
 * dimension per fitted stem, used by the golden eval on its small fixture corpus) is refused when
 * its dense vectors would not fit in memory — it is an eval instrument, not a corpus-scale one.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertQuarantineId,
  buildCorpusSnapshot,
  currencyByDocument,
  isAdmittedProjection,
  planIncrementalRebuild,
  projectDocument,
  resolveWithinRoot,
  verifyCorpusSnapshot,
  type CorpusDocumentInput,
  type CorpusDocumentProjection,
  type ProjectDocumentOutcome,
} from '../../packages/mps-knowledge-corpus/src';
import { calibrateAbstentionThreshold } from '../../packages/mps-knowledge-eval/src';
import {
  bindingOf,
  buildIndexProjection,
  createDeterministicHashEmbeddingProvider,
  createGovernedKnowledgeLookup,
  fitIdfTable,
  searchKnowledgeIndex,
  verifyIndexProjectionWithReembedding,
} from '../../packages/mps-knowledge-index/src';
import { createVerifiedRegistrySourceCatalog } from '../../server/modules/legal/knowledge/VerifiedRegistrySourceCatalogAdapter';
import { PdfParseExtractorAdapter } from '../../server/text-projection/pdfParseExtractorAdapter';

const REPORT_SCHEMA = 'knowledge-corpus-expansion-run-v1' as const;

/** Observability probes only — not an eval, not gold. */
const PROBE_QUERIES: readonly string[] = [
  'bullervillkor vid bostäder för bergtäkt',
  'tillsynsmyndighetens förelägganden och förbud',
  'förbud mot utsläpp av avloppsvatten från enskilt avlopp',
  'tillståndsplikt för miljöfarlig verksamhet',
  'strandskyddsdispens särskilda skäl',
  'kvantmekanisk supraledning i grafenlager',
];

interface QuarantineMetadata {
  readonly quarantine_id: string;
  readonly source_id: string;
  readonly source_url?: string;
  readonly file_name?: string;
  readonly retrieved_at?: string;
  readonly content_hash: string;
  readonly status?: string;
  /** The stale, volatile artifact-id LABEL the harvester wrote. Declared here only to document that it is NEVER read as authority. */
  readonly custom_metadata?: { readonly registry_artifact_id?: string };
}

interface ManifestObjectRef {
  readonly execution_id: string;
  readonly manifest_file: string;
  readonly manifest_sha256: string;
  readonly source_id: string;
  readonly source_content_hash: string;
  readonly registry_artifact_id: string;
}

interface Args {
  readonly quarantine: string;
  readonly out: string;
  readonly limit: number | null;
  readonly sources: readonly string[];
  readonly previous: string | null;
  readonly registry: string | null;
  readonly embedding: string;
}

function parseArgs(argv: readonly string[]): Args {
  const take = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  if (argv.includes('--help')) {
    console.log(
      readFileSync(new URL(import.meta.url))
        .toString()
        .split('*/')[0],
    );
    process.exit(0);
  }
  const sources: string[] = [];
  argv.forEach((a, i) => {
    if (a === '--source' && argv[i + 1]) sources.push(argv[i + 1]!);
  });
  const limitRaw = take('--limit');
  return {
    quarantine: path.resolve(take('--quarantine') ?? '.quarantine'),
    out: path.resolve(take('--out') ?? path.join(tmpdir(), 'knowledge-corpus-runs')),
    limit: limitRaw ? Number.parseInt(limitRaw, 10) : null,
    sources,
    previous: take('--previous'),
    registry: take('--registry'),
    embedding: take('--embedding') ?? 'hashed:1024',
  };
}

const EXACT_MODE_MAX_DENSE_BYTES = 1024 ** 3; // 1 GiB of dense vectors: beyond this, exact mode is refused

function createProvider(mode: string, chunkTexts: readonly string[]) {
  if (mode === 'exact') {
    const idf = fitIdfTable(chunkTexts);
    const dense = (idf.document_frequency.size + 1) * chunkTexts.length * 8;
    if (dense > EXACT_MODE_MAX_DENSE_BYTES) {
      throw new Error(
        `--embedding exact would allocate ~${Math.round(dense / 1024 ** 2)} MiB of dense vectors ` +
          `(${idf.document_frequency.size} stems x ${chunkTexts.length} rows); use --embedding hashed:<dims> at this scale`,
      );
    }
    return {
      provider: createDeterministicHashEmbeddingProvider({ idf }),
      idf_terms: idf.document_frequency.size,
    };
  }
  const m = /^hashed:(\d+)$/.exec(mode);
  if (!m) throw new Error(`--embedding must be "exact" or "hashed:<dims>", got "${mode}"`);
  return {
    provider: createDeterministicHashEmbeddingProvider({ dimensions: Number(m[1]) }),
    idf_terms: null,
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * CONTENT-ONLY mime sniff. The file name is deliberately never consulted: the extractor that runs
 * is part of the materialization identity, so letting a local name choose it would make identity
 * name-dependent for signature-less bytes. Unknown bytes are treated as text.
 */
function sniffMime(bytes: Uint8Array): string {
  const head = Buffer.from(bytes.subarray(0, 512)).toString('latin1');
  if (head.startsWith('%PDF-')) return 'application/pdf';
  const trimmed = (head.charCodeAt(0) === 0xfeff ? head.slice(1) : head).trimStart().toLowerCase();
  if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.startsWith('<'))
    return 'text/html';
  return 'text/plain';
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function loadManifestRefs(root: string): ReadonlyMap<string, ManifestObjectRef> {
  const dir = path.join(root, 'download-manifests');
  const refs = new Map<string, ManifestObjectRef>();
  let files: string[] = [];
  try {
    files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return refs;
  }
  for (const file of files) {
    const raw = readFileSync(path.join(dir, file));
    const manifest = JSON.parse(raw.toString('utf8')) as {
      execution_id: string;
      source_id: string;
      source_content_hash: string;
      registry_artifact_id: string;
      objects: Array<{ quarantine_id: string }>;
    };
    for (const o of manifest.objects ?? []) {
      // Later manifests do not override earlier ones: first sighting wins deterministically (sorted file order).
      if (!refs.has(o.quarantine_id)) {
        refs.set(o.quarantine_id, {
          execution_id: manifest.execution_id,
          manifest_file: file,
          manifest_sha256: sha256(raw),
          source_id: manifest.source_id,
          source_content_hash: manifest.source_content_hash,
          registry_artifact_id: manifest.registry_artifact_id,
        });
      }
    }
  }
  return refs;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const t0 = performance.now();

  // 1. AUTHORITY: the verified signed registry, loaded once (fail closed; an empty registry is refused by the adapter).
  const catalog = await createVerifiedRegistrySourceCatalog(
    args.registry ? { registryPath: args.registry } : {},
  );
  const authorized = await catalog.list();
  if (authorized.length === 0) throw new Error('fail closed: the verified catalog authorizes no sources');

  // 2. INVENTORY: every quarantine object, deterministic order, optional filters.
  const manifestRefs = loadManifestRefs(args.quarantine);
  const metadataFiles = readdirSync(args.quarantine)
    .filter((f) => f.endsWith('.metadata.json'))
    .sort();
  const allMetadata = metadataFiles.map(
    (f) => JSON.parse(readFileSync(path.join(args.quarantine, f), 'utf8')) as QuarantineMetadata,
  );
  const inventoryBySource = new Map<string, number>();
  for (const m of allMetadata)
    inventoryBySource.set(m.source_id, (inventoryBySource.get(m.source_id) ?? 0) + 1);
  let selected = allMetadata;
  if (args.sources.length) selected = selected.filter((m) => args.sources.includes(m.source_id));
  if (args.limit !== null) selected = selected.slice(0, args.limit);

  // 3. PROJECTION through the knowledge plane.
  const extractor = new PdfParseExtractorAdapter();
  const projections: CorpusDocumentProjection[] = [];
  const documents: Array<Record<string, unknown>> = [];
  const outcomeCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const mimeCounts = new Map<string, number>();
  const skippedAuthorityRequired = new Map<string, number>();
  const scopeChanged: Array<{ source_id: string; detail: string }> = [];
  const integrityMismatch: string[] = [];
  const manifestSourceMismatch: string[] = [];
  const perDocMs: number[] = [];
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);

  console.error(
    `[run] ${selected.length}/${allMetadata.length} objects selected; catalog ${catalog.origin} (${catalog.registry_path})`,
  );
  for (const [i, meta] of selected.entries()) {
    if (i > 0 && i % 50 === 0)
      console.error(
        `[progress] ${i}/${selected.length} projected in ${Math.round(performance.now() - t0)} ms`,
      );
    assertQuarantineId(meta.quarantine_id);
    const binPath = resolveWithinRoot(args.quarantine, `${meta.quarantine_id}.bin`);
    const bytes = new Uint8Array(readFileSync(binPath));
    if (sha256(bytes) !== meta.content_hash) {
      // Bytes that do not match their own quarantine record are never projected.
      integrityMismatch.push(meta.quarantine_id);
      bump(outcomeCounts, 'INTEGRITY_MISMATCH');
      continue;
    }
    const mime = sniffMime(bytes);
    bump(mimeCounts, mime);
    // The download manifest is a cross-check ONLY when it names the same source as the object's own
    // record; the manifest's signed-scope hash then becomes the expected hash (a changed scope surfaces
    // as SOURCE_SCOPE_CHANGED instead of a silent re-bind). The metadata's registry_artifact_id label
    // is NEVER used — it is the volatile label (-001 vs -002), not authority.
    const manifestRef = manifestRefs.get(meta.quarantine_id);
    const manifest =
      manifestRef &&
      manifestRef.source_id === meta.source_id &&
      typeof manifestRef.source_content_hash === 'string'
        ? manifestRef
        : undefined;
    if (manifestRef && !manifest) manifestSourceMismatch.push(meta.quarantine_id);
    const input: CorpusDocumentInput = {
      source_id: meta.source_id,
      ...(manifest ? { expected_registry_source_content_hash: manifest.source_content_hash } : {}),
      doc_name: meta.file_name ?? meta.quarantine_id,
      mime_type: mime,
      bytes,
      acquisition: {
        quarantine_id: meta.quarantine_id,
        ...(meta.retrieved_at ? { acquired_at: meta.retrieved_at } : {}),
        ...(meta.source_url ? { source_url: meta.source_url } : {}),
        ...(manifest
          ? {
              download_manifest_ref: {
                id: manifest.execution_id,
                content_hash: { algorithm: 'sha256' as const, digest: manifest.manifest_sha256 },
              },
            }
          : {}),
      },
      // Versions = re-harvests of the same publication locator (source_url). Objects without a URL
      // are singletons: a multi-document source is never treated as one lineage.
    };
    const d0 = performance.now();
    let outcome: ProjectDocumentOutcome;
    try {
      outcome = await projectDocument(input, { catalog, extractor, ocr: { mode: 'disabled' } });
    } catch (err) {
      outcome = {
        kind: 'REJECTED_INPUT',
        source_id: meta.source_id,
        detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const ms = Math.round(performance.now() - d0);
    perDocMs.push(ms);
    bump(outcomeCounts, outcome.kind);
    if (outcome.kind === 'AUTHORITY_UNAVAILABLE') throw new Error(`fail closed: ${outcome.detail}`);
    if (outcome.kind === 'SOURCE_AUTHORITY_REQUIRED') bump(skippedAuthorityRequired, outcome.source_id);
    if (outcome.kind === 'SOURCE_SCOPE_CHANGED')
      scopeChanged.push({ source_id: outcome.source_id, detail: outcome.detail });
    if (outcome.kind !== 'PROJECTED') {
      documents.push({
        quarantine_id: meta.quarantine_id,
        source_id: meta.source_id,
        doc_name: input.doc_name,
        mime,
        bytes: bytes.byteLength,
        outcome: outcome.kind,
        detail: 'detail' in outcome ? outcome.detail : undefined,
        ms,
      });
      continue;
    }
    const doc = outcome.document;
    projections.push(doc);
    bump(statusCounts, doc.status);
    documents.push({
      quarantine_id: meta.quarantine_id,
      source_id: doc.source.source_id,
      registry_artifact_id: doc.source.registry_artifact_id,
      doc_name: doc.doc_name,
      mime,
      bytes: doc.byte_size,
      outcome: 'PROJECTED',
      status: doc.status,
      ...(doc.status_detail ? { status_detail: doc.status_detail } : {}),
      admitted: isAdmittedProjection(doc),
      role: doc.role.role,
      role_method: doc.role.method,
      structure_kind: doc.structure_kind,
      chunk_policy_version: doc.chunk_policy_version,
      extraction: {
        kind: doc.text_projection.extractor.kind,
        version: doc.text_projection.extractor.version,
        status: doc.text_projection.extraction_status,
        chars: doc.text_projection.char_count,
      },
      chunks: doc.chunks.length,
      rejected_fragments: doc.rejected_fragments.length,
      text_coverage:
        doc.text_projection.char_count === 0
          ? 1
          : Math.round(
              Math.min(
                1,
                doc.chunks.reduce((n, c) => n + c.full_text.length, 0) / doc.text_projection.char_count,
              ) * 1e4,
            ) / 1e4,
      link_candidates: doc.link_candidates.length,
      document_id: doc.document_id,
      canonical_record_key: doc.canonical_record_key,
      chunk_set_content_hash: doc.chunk_set_content_hash,
      version_lineage_key: doc.version_lineage_key,
      manifest_cross_checked: manifest !== undefined,
      ms,
    });
  }
  const tProjection = performance.now();
  console.error(
    `[run] projection done: ${projections.length} projected in ${Math.round(tProjection - t0)} ms`,
  );

  // 4. SNAPSHOT (byte-identical acquisitions collapse; keyed version lineages; verification).
  const snapshot = buildCorpusSnapshot(projections, { catalog_origin: catalog.origin });
  const snapshotViolations = verifyCorpusSnapshot(snapshot);
  const currency = currencyByDocument(snapshot.documents, snapshot.version_lineages);
  const governed = createGovernedKnowledgeLookup(snapshot);
  const tSnapshot = performance.now();

  // 5. INDEX read model, in memory, fixture embedding (mode per --embedding), verified against the corpus.
  const chunkTexts = snapshot.documents.flatMap((d) => d.chunks.map((c) => c.full_text));
  const { provider, idf_terms } = createProvider(args.embedding, chunkTexts);
  const tProvider = performance.now();
  console.error(
    `[run] index build: ${chunkTexts.length} chunks x ${provider.dimensions} dims (${args.embedding})`,
  );
  const built = await buildIndexProjection(snapshot, provider);
  const tIndex = performance.now();
  // Re-embed a deterministic sample (100 rows) to verify vector CONTENT too — the only witness a vector has.
  const indexViolations = await verifyIndexProjectionWithReembedding(built.index, snapshot, {
    reembed: { provider, sample_size: 100 },
  });
  // Incremental path: rebuilding against the just-built index must reuse every vector.
  const rebuilt = await buildIndexProjection(snapshot, provider, { reuse: built.index });
  const tRebuild = performance.now();
  console.error(
    `[run] index built in ${Math.round(tIndex - tProvider)} ms; reuse rebuild ${Math.round(tRebuild - tIndex)} ms; violations ${indexViolations.length}`,
  );

  // 6. CALIBRATION + PROBES (observability sample; every hit resolved against the governed corpus).
  // A read model that fails verification is not probed — that is the point of the verifier.
  const calibration =
    indexViolations.length === 0 ? await calibrateAbstentionThreshold(built.index, provider, governed) : null;
  const probes = [];
  if (calibration) {
    for (const query of PROBE_QUERIES) {
      const q0 = performance.now();
      const out = await searchKnowledgeIndex(
        built.index,
        provider,
        { query, top_k: 5, abstain_below_score: calibration.threshold },
        governed,
      );
      probes.push({
        query,
        kind: out.kind,
        candidate_count: out.candidate_count,
        ms: Math.round(performance.now() - q0),
        hits: out.hits.map((h) => ({
          score: Math.round(h.score * 1e4) / 1e4,
          source_id: h.provenance.source_id,
          registry_artifact_id: h.provenance.registry_artifact_id,
          document_id: h.provenance.document_id,
          role: h.provenance.role,
          role_method: h.provenance.role_method,
          is_current: h.provenance.is_current,
          currency_method: h.provenance.currency_method,
          currency_reason: h.provenance.currency_reason,
          anchor:
            (h.row.metadata.chapter !== undefined
              ? `${h.row.metadata.chapter} kap. ${h.row.metadata.paragraph ?? '?'} §`
              : undefined) ??
            h.row.metadata.court_section ??
            h.row.metadata.evidence_anchor ??
            `seq${h.row.metadata.sequence}`,
          provenance_refs: h.result.source_provenance_refs,
        })),
      });
    }
  }

  // 7. INCREMENTAL plan against an earlier report, if given.
  let incremental: Record<string, unknown> | null = null;
  if (args.previous) {
    const prev = JSON.parse(readFileSync(args.previous, 'utf8')) as {
      report_schema?: string;
      snapshot?: {
        snapshot_identity: string;
        documents: Array<{
          document_id: string;
          canonical_record_key: string;
          chunk_set_content_hash: string;
        }>;
      };
    };
    if (prev.report_schema !== REPORT_SCHEMA || !prev.snapshot)
      throw new Error(`--previous is not a ${REPORT_SCHEMA} report`);
    const plan = planIncrementalRebuild(prev.snapshot, snapshot);
    incremental = {
      previous_report: args.previous,
      previous_snapshot_identity: prev.snapshot.snapshot_identity,
      unchanged: plan.unchanged.length,
      changed: plan.changed.length,
      added: plan.added.length,
      removed: plan.removed.length,
      relabeled: plan.relabeled.length,
      changed_keys: plan.changed.slice(0, 50),
      added_keys: plan.added.slice(0, 50),
      removed_keys: plan.removed.slice(0, 50),
      relabeled_sample: plan.relabeled.slice(0, 50),
    };
  }

  const sortedMs = [...perDocMs].sort((a, b) => a - b);
  const mem = process.memoryUsage();
  const report = {
    report_schema: REPORT_SCHEMA,
    run: {
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      node: process.version,
      quarantine_root: args.quarantine,
      registry_path: catalog.registry_path,
      registry_digest: catalog.registry_digest,
      catalog_origin: catalog.origin,
      catalog_loaded_at: catalog.loaded_at,
      limit: args.limit,
      source_filter: args.sources,
      db_writes: 0,
      governed_writes: 0,
    },
    sources: {
      authorized: authorized.map((b) => ({
        source_id: b.source_id,
        registry_artifact_id: b.registry_artifact_id,
        registry_source_content_hash: b.registry_source_content_hash,
        artifact_types: b.artifact_types,
      })),
      inventory_by_source: Object.fromEntries([...inventoryBySource.entries()].sort()),
      skipped_authority_required: Object.fromEntries([...skippedAuthorityRequired.entries()].sort()),
      scope_changed: scopeChanged,
    },
    objects: {
      inventory_total: allMetadata.length,
      selected: selected.length,
      integrity_mismatch: integrityMismatch,
      manifest_source_mismatch: manifestSourceMismatch,
      outcomes: Object.fromEntries([...outcomeCounts.entries()].sort()),
      statuses: Object.fromEntries([...statusCounts.entries()].sort()),
      mimes: Object.fromEntries([...mimeCounts.entries()].sort()),
      admitted: projections.filter(isAdmittedProjection).length,
      chunks_total: projections.reduce((n, d) => n + d.chunks.length, 0),
      rejected_fragments_total: projections.reduce((n, d) => n + d.rejected_fragments.length, 0),
      link_candidates_total: projections.reduce((n, d) => n + d.link_candidates.length, 0),
      roles: Object.fromEntries(
        [
          ...projections
            .reduce(
              (m, d) =>
                m.set(`${d.role.role}/${d.role.method}`, (m.get(`${d.role.role}/${d.role.method}`) ?? 0) + 1),
              new Map<string, number>(),
            )
            .entries(),
        ].sort(),
      ),
    },
    documents,
    snapshot: {
      snapshot_identity: snapshot.snapshot_identity,
      document_count: snapshot.documents.length,
      duplicates: snapshot.duplicates,
      version_lineages: snapshot.version_lineages.map((l) => ({
        source_id: l.source_id,
        version_lineage_key: l.version_lineage_key,
        currency_method: l.currency_method,
        members: l.members.length,
        current: l.members.filter((m) => m.is_current).map((m) => m.document_id),
        ambiguous_current: l.ambiguous_current,
      })),
      documents_current: snapshot.documents.filter((d) => currency.get(d.document_id)!.is_current).length,
      documents_in_lineages: snapshot.documents.filter(
        (d) => currency.get(d.document_id)!.method === 'ACQUISITION_RECENCY',
      ).length,
      verification_violations: snapshotViolations,
      documents: snapshot.documents.map((d) => ({
        document_id: d.document_id,
        canonical_record_key: d.canonical_record_key,
        chunk_set_content_hash: d.chunk_set_content_hash,
        source_id: d.source.source_id,
        status: d.status,
        chunks: d.chunks.length,
        is_current: currency.get(d.document_id)!.is_current,
        currency_method: currency.get(d.document_id)!.method,
      })),
    },
    index: {
      index_snapshot_identity: built.index.index_snapshot_identity,
      provider: bindingOf(provider),
      embedding_mode: args.embedding,
      idf_terms,
      rows: built.index.rows.length,
      skipped_documents: built.index.skipped_documents.length,
      verification_violations: indexViolations,
      build_stats: built.stats,
      rebuild_with_reuse: {
        rows: rebuilt.index.rows.length,
        identity_equal: rebuilt.index.index_snapshot_identity === built.index.index_snapshot_identity,
        stats: rebuilt.stats,
      },
      degenerate_rows_lt4_tokens: built.index.rows.filter((r) => r.chunk_text.trim().split(/\s+/).length < 4)
        .length,
    },
    calibration,
    probes,
    incremental,
    timings_ms: {
      total: Math.round(performance.now() - t0),
      projection: {
        sum: Math.round(tProjection - t0),
        p50: percentile(sortedMs, 50),
        p95: percentile(sortedMs, 95),
        max: percentile(sortedMs, 100),
      },
      snapshot: Math.round(tSnapshot - tProjection),
      provider_fit: Math.round(tProvider - tSnapshot),
      index_build: Math.round(tIndex - tProvider),
      index_rebuild_with_reuse: Math.round(tRebuild - tIndex),
    },
    memory_mb: { rss: Math.round(mem.rss / 1048576), heap_used: Math.round(mem.heapUsed / 1048576) },
  };

  mkdirSync(args.out, { recursive: true });
  const file = path.join(
    args.out,
    `knowledge-corpus-run-${snapshot.snapshot_identity.slice(0, 16)}-${built.index.index_snapshot_identity.slice(0, 16)}.json`,
  );
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(
    JSON.stringify(
      {
        report: file,
        size_bytes: statSync(file).size,
        objects: report.objects,
        snapshot_identity: snapshot.snapshot_identity,
        documents_current: report.snapshot.documents_current,
        lineages: snapshot.version_lineages.length,
        index_rows: built.index.rows.length,
        snapshot_violations: snapshotViolations.length,
        index_violations: indexViolations.length,
        calibration_threshold: calibration?.threshold ?? null,
        timings_ms: report.timings_ms,
        memory_mb: report.memory_mb,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
