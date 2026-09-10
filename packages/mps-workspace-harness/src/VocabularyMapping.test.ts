/**
 * WORKSPACE-LIFECYCLE-CONTROLLER-V1 — the vocabulary mapping is delivered twice, so it is asserted
 * once (spec A30 / Del D item 18).
 *
 * The mapping exists in two forms because two different readers need it: an adversarial verifier
 * reads the markdown, and the acceptance report binds a digest over the JSON. Two forms of the same
 * contract drift — the JSON gets a new row, the prose keeps the old ruling, and the document an
 * auditor reads stops describing the artifact a gate checks. These tests are the reason that cannot
 * happen quietly.
 *
 * The markdown is checked in BOTH of its own forms as well: the summary table and the per-row
 * sections. They are written by hand and can disagree with each other without either disagreeing
 * with the JSON, which would leave a reader believing whichever half they happened to read.
 *
 * Evidence and deviation are asserted non-empty because a row without them is the failure mode the
 * deliverable exists to prevent: a ruling with no traceable file behind it is an assertion, and an
 * unexplained divergence is the thing that gets "harmonised" back into the existing type later.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const JSON_PATH = join(
  REPO_ROOT,
  'packages',
  'mps-workspace-observer',
  'contracts',
  'vocabulary-mapping-v1.json',
);
const MARKDOWN_PATH = join(
  REPO_ROOT,
  'docs',
  'architecture',
  'WORKSPACE-LIFECYCLE-CONTROLLER-V1-VOCABULARY-MAPPING.md',
);

interface MappingRow {
  readonly workspaceConcept: string;
  readonly existingContract: string;
  readonly ruling: string;
  readonly evidence: string;
  readonly deviation: string;
  readonly v1Impact: string;
}

interface MappingDocument {
  readonly schemaId: string;
  readonly version: string;
  readonly rows: readonly MappingRow[];
}

const doc = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as MappingDocument;
const markdown = readFileSync(MARKDOWN_PATH, 'utf8');

/** The summary table: rows between the header and the first line that is not a table row. */
function summaryTableRulings(md: string): ReadonlyMap<string, string> {
  const lines = md.split(/\r?\n/);
  const header = lines.findIndex((l) => l.startsWith('| Workspace concept | Ruling |'));
  expect(header, 'the markdown must carry a "Workspace concept | Ruling" summary table').
    toBeGreaterThanOrEqual(0);
  const out = new Map<string, string>();
  // header + 1 is the |---|---| separator, which carries no row.
  for (let i = header + 2; i < lines.length && lines[i].startsWith('|'); i += 1) {
    const cells = lines[i].split('|').map((c) => c.trim());
    // A row is | concept | ruling |, so split gives ['', concept, ruling, ''].
    out.set(cells[1], cells[2]);
  }
  return out;
}

/** The per-row sections: `### <concept>` followed, somewhere below, by `**Ruling:** <RULING>`. */
function sectionRulings(md: string): ReadonlyMap<string, string> {
  const lines = md.split(/\r?\n/);
  const out = new Map<string, string>();
  let concept: string | null = null;
  for (const line of lines) {
    if (line.startsWith('### ')) {
      concept = line.slice(4).trim();
      continue;
    }
    if (concept !== null && line.startsWith('**Ruling:**')) {
      out.set(concept, line.slice('**Ruling:**'.length).trim());
      concept = null;
    }
  }
  return out;
}

const tableRulings = summaryTableRulings(markdown);
const prosRulings = sectionRulings(markdown);

describe('WORKSPACE_LIFECYCLE_V1_VOCABULARY_MAPPING', () => {
  it('VM01 is the artifact the spec names, at the version the harness cites', () => {
    expect(doc.schemaId).toBe('WORKSPACE_LIFECYCLE_V1_VOCABULARY_MAPPING');
    expect(doc.version).toBe('1.0.0');
    expect(doc.rows.length).toBeGreaterThan(0);
  });

  it('VM02 covers every concept Del G requires a ruling for', () => {
    // Del G's rows, plus the three the patch adds in A4/A11/A13. Named explicitly rather than
    // counted, so deleting a row fails here instead of silently shrinking the deliverable.
    const required = [
      'unitId, baseSha, candidateSha, branch, scope',
      'unit lifecycle and terminality',
      'IMPLEMENTER / VERIFIER lease evidence',
      'future cleanup lease',
      'workspace blockers and findings',
      'identityDigest versus CAS content_hash',
      'canonicalization primitive and domains',
      'reconciliation evidence',
      'Observer to Classifier boundary',
      'authoritative acceptance',
      'observation states versus capture coverage codes versus transport failure codes',
    ];
    const present = doc.rows.map((r) => r.workspaceConcept);
    for (const concept of required) expect(present).toContain(concept);
  });

  it('VM03 has no duplicate concept key', () => {
    const keys = doc.rows.map((r) => r.workspaceConcept);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('VM04 states the same row set in the JSON, the summary table and the prose sections', () => {
    const jsonKeys = doc.rows.map((r) => r.workspaceConcept).sort();
    expect([...tableRulings.keys()].sort()).toEqual(jsonKeys);
    expect([...prosRulings.keys()].sort()).toEqual(jsonKeys);
  });

  it('VM05 states the same ruling for a concept in all three places', () => {
    for (const row of doc.rows) {
      expect(tableRulings.get(row.workspaceConcept)).toBe(row.ruling);
      expect(prosRulings.get(row.workspaceConcept)).toBe(row.ruling);
    }
  });

  it('VM06 gives every row a ruling that reads as a ruling, not as a sentence', () => {
    for (const row of doc.rows) expect(row.ruling).toMatch(/^[A-Z][A-Z0-9_]*$/);
  });

  it('VM07 gives every row a non-empty evidence and deviation', () => {
    for (const row of doc.rows) {
      expect(row.evidence.trim().length, `evidence for ${row.workspaceConcept}`).toBeGreaterThan(0);
      expect(row.deviation.trim().length, `deviation for ${row.workspaceConcept}`).toBeGreaterThan(
        0,
      );
      expect(row.existingContract.trim().length).toBeGreaterThan(0);
      expect(row.v1Impact.trim().length).toBeGreaterThan(0);
    }
  });

  it('VM08 records the three facts a later reader is most likely to get wrong', () => {
    const byConcept = new Map(doc.rows.map((r) => [r.workspaceConcept, r]));

    // The terminal set, because an empty successor list is easy to misread as "PROMOTED ends it".
    const lifecycle = byConcept.get('unit lifecycle and terminality');
    expect(lifecycle?.evidence).toContain('CLOSED');
    expect(lifecycle?.evidence).toContain('CANCELLED');
    expect(lifecycle?.evidence).toContain('SUPERSEDED');
    expect(lifecycle?.evidence).toMatch(/PROMOTED.*NOT terminal/s);

    // Why the workspace types are not the existing type, because this is what gets harmonised back.
    const findings = byConcept.get('workspace blockers and findings');
    expect(findings?.ruling).toBe('DO_NOT_REUSE_THE_TYPE');
    expect(findings?.deviation).toContain('blockerScope');

    // That the third contentEvidence value is not emittable at this base.
    const reconciliation = byConcept.get('reconciliation evidence');
    expect(reconciliation?.evidence).toContain("'NONE' | 'PATCH_ID_MATCH'");
    expect(reconciliation?.evidence).toContain('REGISTERED_RECONCILIATION');
  });
});
