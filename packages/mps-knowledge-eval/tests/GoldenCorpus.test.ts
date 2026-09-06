import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  currencyByDocument,
  isAdmittedProjection,
  verifyCorpusSnapshot,
} from '@miljobeslut/mps-knowledge-corpus';

import {
  calculateSourceRegistryContentHash,
  sourceRegistryArtifactForHash,
} from '../../mps-data-governance/src/SourceRegistry';
import { buildGoldenCorpus } from '../fixtures/buildGoldenCorpus';
import { REAL_REGISTRY_BINDINGS, REAL_REGISTRY_FIXTURE_ORIGIN } from '../fixtures/real/registryBindings';

describe('K2.2 golden corpus fixture — authority handling, adversarial documents, real-source binding', () => {
  it('the fixture registry bindings still equal the committed signed registry (drift detection; the fixture is not authority)', () => {
    const registryPath = path.resolve(process.cwd(), 'source-registry/national-registry.json');
    const entries = JSON.parse(readFileSync(registryPath, 'utf8')) as Array<
      Record<string, unknown> & { source_id: string; artifact_id: string; artifact_types: string[] }
    >;
    expect(entries).toHaveLength(REAL_REGISTRY_BINDINGS.length);
    for (const e of entries) {
      const binding = REAL_REGISTRY_BINDINGS.find((b) => b.source_id === e.source_id);
      expect(binding, e.source_id).toBeDefined();
      expect(binding!.registry_artifact_id).toBe(e.artifact_id);
      expect(binding!.registry_source_content_hash).toBe(
        calculateSourceRegistryContentHash(sourceRegistryArtifactForHash(e as never)),
      );
      expect([...binding!.artifact_types]).toEqual(e.artifact_types);
    }
    // The fixture catalog can never be mistaken for the signed registry: it lives in the static namespace.
    expect(REAL_REGISTRY_FIXTURE_ORIGIN.startsWith('static:')).toBe(true);
  });

  it('builds deterministically, verifies, and skips exactly the unauthorized document as SOURCE_AUTHORITY_REQUIRED', async () => {
    const a = await buildGoldenCorpus();
    const b = await buildGoldenCorpus();
    expect(b.snapshot.snapshot_identity).toBe(a.snapshot.snapshot_identity);
    expect(verifyCorpusSnapshot(a.snapshot)).toEqual([]);
    expect(a.skipped.map((s) => [s.key, s.outcome.kind])).toEqual([
      ['unauthorized_handbook', 'SOURCE_AUTHORITY_REQUIRED'],
    ]);
    expect(Object.keys(a.docs)).not.toContain('unauthorized_handbook');
    expect(a.snapshot.documents.every((d) => d.source.registry_artifact_id !== 'reg-evil-001')).toBe(true);
    expect(a.snapshot.catalog_origin).toBe(REAL_REGISTRY_FIXTURE_ORIGIN);
  });

  it('real statute excerpts bind to the real active registry identities and admit as law with chapter/paragraph structure', async () => {
    const { docs } = await buildGoldenCorpus();
    const mb = docs.mb_kap2!;
    expect(mb.source.source_id).toBe('regeringskansliet-sfs-1998-808');
    expect(mb.source.registry_artifact_id).toBe('reg-rk-sfs-1998-808-002');
    expect(mb.role).toMatchObject({ role: 'law', method: 'SOURCE_DECLARED' });
    expect(mb.chunk_policy_version).toBe('legal-chunker-v2.4.1');
    expect(isAdmittedProjection(mb)).toBe(true);
    expect(
      mb.chunks.some((c) => c.structure_kind === 'law' && c.chapter === '2' && c.paragraph === '3'),
    ).toBe(true);
    const pbf = docs.pbf_kap1!;
    expect(pbf.source.source_id).toBe('regeringskansliet-sfs-2011-338');
    expect(pbf.source.registry_artifact_id).toBe('reg-rk-sfs-2011-338-002');
    // FMH 1998:899 has no chapter division of its own. OBSERVED v2.4.1 behaviour on the real text
    // (documented limitation, LegalChunker.ts:107-125): cross-references such as "enligt 9 kap.
    // miljöbalken" are read as chapter markers, so chunks carry the cited statute's chapter labels
    // rather than "(ingen kapitelindelning)". The same relabeling hits MB 2 kap. 7 §, 26 kap. 9 §
    // and MPF 1 kap. 1 § (their gold predicates are therefore text-bound). Recorded here as-is —
    // fixing it is a chunk-policy bump, out of K2.2's scope. Paragraph anchors and text remain correct.
    const fmh = docs.fmh_start!;
    expect(fmh.chunks.length).toBeGreaterThan(0);
    expect(fmh.chunks.every((c) => c.structure_kind === 'law' && /^\d/.test(c.paragraph))).toBe(true);
    expect(
      fmh.chunks.some(
        (c) =>
          c.structure_kind === 'law' &&
          c.paragraph === '1' &&
          c.full_text.includes('miljöfarlig verksamhet och hälsoskydd'),
      ),
    ).toBe(true);
    // Excerpts of one harvested page are distinct fixture documents, each its own lineage: all current.
    const { snapshot } = await buildGoldenCorpus();
    const currency = currencyByDocument(snapshot.documents, snapshot.version_lineages);
    for (const key of ['mb_kap1', 'mb_kap2', 'mb_kap9', 'mb_kap26', 'pbl_kap1', 'pbl_kap9'])
      expect(currency.get(docs[key]!.document_id), key).toMatchObject({
        is_current: true,
        method: 'NO_LINEAGE',
      });
  });

  it('adversarial documents are handled explicitly: failed extraction, empty text, prompt injection, near-duplicate', async () => {
    const { docs, snapshot } = await buildGoldenCorpus();
    expect(docs.scan_failed!.status).toBe('EXTRACTION_FAILED');
    expect(docs.scan_failed!.chunks).toHaveLength(0);
    expect(['EMPTY_TEXT', 'EXTRACTION_FAILED']).toContain(docs.empty_page!.status);
    expect(docs.injection_guidance!.role.role).toBe('standard');
    expect(docs.injection_guidance!.source.registry_artifact_id).toBe('reg-sgu-well-drilling-guidance-002');
    expect(
      docs.injection_guidance!.chunks.some((c) => c.full_text.includes('IGNORE PREVIOUS INSTRUCTIONS')),
    ).toBe(true);
    expect(docs.court_buller_near_duplicate!.document_id).not.toBe(docs.court_buller!.document_id);
    expect(snapshot.duplicates).toHaveLength(0);
  });

  it('the synthetic Mora family: source-declared decision, caller-refined MKB/technical/control, and a KEYED version lineage of exactly the two decisions', async () => {
    const { docs, snapshot } = await buildGoldenCorpus();
    expect(docs.mora_decision_v1!.role).toMatchObject({
      role: 'evidence_decision',
      method: 'SOURCE_DECLARED',
    });
    expect(docs.mora_mkb!.role).toMatchObject({ role: 'evidence_mkb', method: 'CALLER_DECLARED' });
    expect(docs.mora_technical!.role.role).toBe('evidence_technical');
    expect(docs.mora_control!.role.role).toBe('evidence_control');
    const lineage = snapshot.version_lineages.find(
      (l) =>
        l.source_id === 'falkenbergs-kommun-mhn-decisions' && l.version_lineage_key === 'mhn:dnr:M-2024-0101',
    );
    expect(lineage).toBeDefined();
    expect(lineage!.currency_method).toBe('ACQUISITION_RECENCY');
    expect(lineage!.ambiguous_current).toBe(false);
    expect(new Set(lineage!.members.map((m) => m.document_id))).toEqual(
      new Set([docs.mora_decision_v1!.document_id, docs.mora_decision_v2!.document_id]),
    );
    expect(
      lineage!.members.find((m) => m.document_id === docs.mora_decision_v2!.document_id)?.is_current,
    ).toBe(true);
    expect(
      lineage!.members.find((m) => m.document_id === docs.mora_decision_v1!.document_id)?.is_current,
    ).toBe(false);
    // The MKB, technical description and control program are other documents of the same source,
    // NOT versions of the decision: they are in no lineage and are current by definition.
    const currency = currencyByDocument(snapshot.documents, snapshot.version_lineages);
    for (const key of ['mora_mkb', 'mora_technical', 'mora_control'])
      expect(currency.get(docs[key]!.document_id), key).toMatchObject({
        is_current: true,
        method: 'NO_LINEAGE',
      });
    expect(
      docs.mora_decision_v1!.link_candidates.some(
        (l) => l.relation === 'controlled_by' && l.target === 'control_program' && l.canonical === false,
      ),
    ).toBe(true);
  });

  it('DOCUMENTED UPSTREAM LIMITATION: EvidenceChunker v2.3 drops the control program VATTENKONTROLL body (marker regex matches a "Grundvatten…" body line) — visible as text coverage, never silently', async () => {
    const { docs } = await buildGoldenCorpus();
    const control = docs.mora_control!;
    expect(control.status).toBe('PROJECTED');
    expect(control.rejected_fragments).toHaveLength(0);
    const anchors = control.chunks.map((c) =>
      c.structure_kind === 'evidence' ? c.evidence_anchor : undefined,
    );
    expect(anchors).not.toContain('VATTENKONTROLL');
    expect(control.chunks.some((c) => c.full_text.includes('avläses månadsvis'))).toBe(false);
    const coverage =
      control.chunks.reduce((n, c) => n + c.full_text.length, 0) / control.text_projection.char_count;
    expect(coverage).toBeLessThan(0.9);
  });
});
