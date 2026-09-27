/**
 * D5 godkännandegrind (DEMO-01, K-20 §5 / K-26 §5).
 *
 * The user decides every row (accept / edit / strike). Only then is the approved state frozen:
 * canonical JSON → sha256 → content-addressed file → audit post. PDFs are rendered from the
 * frozen file only (see pdf.ts), never from the live case.
 */
import { execFileSync } from 'node:child_process';
import { freeze } from './caseStore';
import { assertEveryRowHasProvenance } from './proposalEngine';
import type { DemoCase, ProposalRow, RowDecision } from './types';

export const FROZEN_SCHEMA = 'demo01.approved-proposal.v1';

let cachedReleaseSha: string | null = null;

/** Commit the running code was built from; "-dirty" when the worktree has uncommitted changes. */
export function releaseSha(): string {
  if (process.env.DEMO_RELEASE_SHA) return process.env.DEMO_RELEASE_SHA;
  if (cachedReleaseSha) return cachedReleaseSha;
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
    cachedReleaseSha = dirty ? `${head}-dirty` : head;
  } catch {
    cachedReleaseSha = 'okänd';
  }
  return cachedReleaseSha;
}

export interface FrozenProposal {
  schema: typeof FROZEN_SCHEMA;
  caseId: string;
  approvedAt: string;
  approvedByUserId: string;
  releaseSha: string;
  input: DemoCase['input'];
  underlag: DemoCase['underlag'] | null;
  rows: ProposalRow[];
  decisions: RowDecision[];
  struckRowIds: string[];
  inputs: NonNullable<DemoCase['proposal']>['inputs'];
  proposalGeneratedAt: string;
}

/** Pure: applies decisions. Throws unless every proposal row has exactly one decision. */
export function applyDecisions(rows: ProposalRow[], decisions: RowDecision[]): { approved: ProposalRow[]; struck: string[] } {
  const byId = new Map<string, RowDecision>();
  for (const d of decisions) {
    if (byId.has(d.rowId)) throw new Error(`duplicate_decision:${d.rowId}`);
    byId.set(d.rowId, d);
  }
  const unknown = decisions.filter((d) => !rows.some((r) => r.id === d.rowId));
  if (unknown.length) throw new Error(`decision_for_unknown_row:${unknown.map((d) => d.rowId).join(',')}`);
  const undecided = rows.filter((r) => !byId.has(r.id));
  if (undecided.length) throw new Error(`undecided_rows:${undecided.map((r) => r.id).join(',')}`);

  const approved: ProposalRow[] = [];
  const struck: string[] = [];
  for (const r of rows) {
    const d = byId.get(r.id)!;
    if (d.action === 'strike') {
      struck.push(r.id);
    } else if (d.action === 'accept') {
      approved.push(r);
    } else {
      const text = d.text.trim();
      if (!text) throw new Error(`empty_edit:${r.id}`);
      // An edited row is the user's text; the original source is kept alongside, not claimed.
      approved.push({
        ...r,
        text,
        provenance: { kind: 'user_input', field: `redigerad:${r.id}` },
        note: [`användarens uppgift, redigerad från ${r.provenance.kind === 'user_input' ? 'egen uppgift' : 'föreslagen rad'}`, r.note].filter(Boolean).join('; '),
        editedFrom: r.provenance,
      });
    }
  }
  assertEveryRowHasProvenance(approved);
  return { approved, struck };
}

export function freezeApproval(record: DemoCase, decisions: RowDecision[], userId: string): FrozenProposal & { sha256: string; path: string } {
  if (!record.proposal) throw new Error('no_proposal');
  const { approved, struck } = applyDecisions(record.proposal.rows, decisions);
  const doc: FrozenProposal = {
    schema: FROZEN_SCHEMA,
    caseId: record.id,
    approvedAt: new Date().toISOString(),
    approvedByUserId: userId,
    releaseSha: releaseSha(),
    input: record.input,
    underlag: record.underlag ?? null,
    rows: approved,
    decisions,
    struckRowIds: struck,
    inputs: record.proposal.inputs,
    proposalGeneratedAt: record.proposal.generatedAt,
  };
  const { sha256, path } = freeze(doc);
  return { ...doc, sha256, path };
}
