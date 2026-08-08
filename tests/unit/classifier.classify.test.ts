/**
 * Unit tests for Mimer classifier (deterministic rules + thresholds).
 */
import { describe, expect, it } from 'vitest';
import {
  actionForConfidence,
  buildClassifierArtifact,
  classifyFingerprint,
  confidenceBand,
  type PathFingerprint,
} from '../../packages/mimers-brunn-core/src/classifier/index';

function fp(partial: Partial<PathFingerprint> & Pick<PathFingerprint, 'basename' | 'rel_path'>): PathFingerprint {
  return {
    abs_path: partial.abs_path ?? `H:/x/${partial.rel_path}`,
    rel_path: partial.rel_path,
    basename: partial.basename,
    parent_dirs: partial.parent_dirs ?? ['_migration_from_D', 'D_ingest_arkiv', 'legal'],
    is_directory: partial.is_directory ?? true,
    file_count: partial.file_count ?? 10,
    total_bytes: partial.total_bytes ?? 1000,
    ext_histogram: partial.ext_histogram ?? { '.json': 10 },
    sample_names: partial.sample_names ?? ['manifest.json'],
    mime_hints: partial.mime_hints ?? ['application/json'],
    manifest_signals: partial.manifest_signals ?? null,
    url_signals: partial.url_signals ?? [],
  };
}

describe('classifier thresholds', () => {
  it('maps confidence bands to actions', () => {
    expect(confidenceBand(0.99)).toBe('high');
    expect(actionForConfidence(0.99)).toBe('AUTO_MOVE');
    expect(confidenceBand(0.86)).toBe('medium');
    expect(actionForConfidence(0.86)).toBe('HITL_REVIEW');
    expect(confidenceBand(0.4)).toBe('low');
    expect(actionForConfidence(0.4)).toBe('QUARANTINE_REVIEW');
  });
});

describe('classifyFingerprint', () => {
  it('auto-moves unambiguous domstol-history', () => {
    const { artifact, matched_rule_id } = classifyFingerprint(
      fp({
        basename: 'domstol-history',
        rel_path:
          'Documents/Sources/_migration_from_D/2026-06-19/D_ingest_arkiv/legal/domstol-history',
      }),
      { artifact_id: 'CLS-TEST-001' },
    );
    expect(matched_rule_id).toBe('domstol_history');
    expect(artifact.action).toBe('AUTO_MOVE');
    expect(artifact.predicted_provider).toBe('Domstolsverket');
    expect(artifact.confidence).toBeGreaterThan(0.98);
  });

  it('HITL for curated-downloads (directory beats URL)', () => {
    const { artifact, matched_rule_id } = classifyFingerprint(
      fp({
        basename: 'curated-downloads',
        rel_path: '…/legal/curated-downloads',
        url_signals: ['https://www.riksdagen.se/x'],
      }),
      { artifact_id: 'CLS-TEST-002' },
    );
    expect(matched_rule_id).toBe('curated_downloads_mixed');
    expect(artifact.action).toBe('HITL_REVIEW');
    expect(artifact.predicted_provider).toBe('Legal');
  });

  it('quarantines open-source-sweep', () => {
    const { artifact } = classifyFingerprint(
      fp({ basename: 'open-source-sweep', rel_path: '…/legal/open-source-sweep' }),
      { artifact_id: 'CLS-TEST-003' },
    );
    expect(artifact.action).toBe('QUARANTINE_REVIEW');
    expect(artifact.predicted_provider).toBe('UNKNOWN');
  });

  it('buildClassifierArtifact sets artifact_type', () => {
    const a = buildClassifierArtifact({
      artifact_id: 'CLS-X',
      input_path: 'x',
      fingerprint: fp({ basename: 'x', rel_path: 'x' }),
      predicted_provider: null,
      predicted_dataset: null,
      predicted_target: null,
      confidence: 0.5,
      reasoning: 't',
      matched_patterns: [],
      action: 'HITL_REVIEW',
    });
    expect(a.artifact_type).toBe('CLASSIFIER');
    expect(a.schema_version).toBe('1.0');
  });
});
