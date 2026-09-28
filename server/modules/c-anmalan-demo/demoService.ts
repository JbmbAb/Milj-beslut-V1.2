/**
 * DEMO-01 orchestration: case → proposal (D3) → radvis godkännande (D5) → PDF from frozen JSON.
 * No submit exists here (K-26 §6).
 */
import { lookupPropertyByDesignationFromPostgis } from '../../services/propertyUnitService';
import { auditTrail, getAuditTrail } from '../../services/auditTrailService';
import type { AuthUser } from '../../security/types';
import { freezeApproval, type FrozenProposal } from './approvalGate';
import { canonicalJson, loadBlob, loadCase, loadFrozen, newCaseId, saveCase } from './caseStore';
import { citeMpfCodes } from './legalCitation';
import { LOCALIZATION_LABEL, localizationRows, readLayerFacts } from './localization';
import { renderAnmalanPdf, renderEgenkontrollPdf } from './pdf';
import { buildProposalRows } from './proposalEngine';
import { loadRequirements } from './requirementsSource';
import type { DemoCase, DemoCaseInput, RowDecision, UnderlagRef } from './types';

type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const reference = (id: string) => `DEMO01-${id}`;

function access(id: string, user: AuthUser): Result<DemoCase> {
  const record = loadCase(id);
  if (!record) return { ok: false, status: 404, error: 'not_found' };
  if (record.organisationId !== user.organisationId) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true, value: record };
}

/** `underlag` is passed only by the local underlag loader; the HTTP routes never set it. */
export async function createCase(
  user: AuthUser,
  projectId: string,
  input: DemoCaseInput,
  underlag?: UnderlagRef,
): Promise<Result<DemoCase>> {
  // Reused property lookup: validates project membership and writes the property-access audit.
  await lookupPropertyByDesignationFromPostgis(
    { projectId, propertyDesignation: input.propertyDesignation, purpose: 'demo01_c_anmalan' },
    user,
  );
  const now = new Date().toISOString();
  const record: DemoCase = {
    id: newCaseId(),
    createdAt: now,
    updatedAt: now,
    createdByUserId: user.id,
    organisationId: user.organisationId,
    input,
    ...(underlag ? { underlag } : {}),
    status: 'DRAFT',
  };
  saveCase(record);
  return { ok: true, value: record };
}

export function getCase(user: AuthUser, id: string): Result<DemoCase> {
  return access(id, user);
}

/** Changing the input discards the proposal and approval of this case (the frozen file stays). */
/**
 * An approved case is only changed on an explicit reopen, which is audited: a save or a new
 * proposal must never silently discard the user's approval (defect seen 2026-09-27 17:20, where an
 * unchanged save cleared the approval pointer; the frozen file and audit post were unaffected).
 */
async function guardApproved(user: AuthUser, record: DemoCase, reopen: boolean, what: string): Promise<Result<null>> {
  if (record.status !== 'APPROVED') return { ok: true, value: null };
  if (!reopen) return { ok: false, status: 409, error: 'approved_case_requires_reopen' };
  await auditTrail.logAction(
    reference(record.id),
    'APPLICATION_UPDATED',
    'Document',
    record.id,
    user.id,
    `DEMO-01: godkännandet upphävt av användaren (${what}); tidigare fryst JSON ${record.approval?.frozenSha256 ?? '–'} ligger kvar`,
    { userRole: user.role, details: { reopenedFrozenSha256: record.approval?.frozenSha256 ?? null, reason: what } },
  );
  return { ok: true, value: null };
}

export async function updateInput(user: AuthUser, id: string, input: DemoCaseInput, reopen = false): Promise<Result<DemoCase>> {
  const got = access(id, user);
  if (got.ok === false) return got;
  if (input.propertyDesignation !== got.value.input.propertyDesignation) {
    return { ok: false, status: 400, error: 'property_change_requires_new_case' };
  }
  // Saving unchanged input is a no-op: nothing is discarded.
  if (canonicalJson(input) === canonicalJson(got.value.input)) return { ok: true, value: got.value };
  const guard = await guardApproved(user, got.value, reopen, 'ändrade uppgifter');
  if (guard.ok === false) return guard;
  // A field the user rewrote is no longer a quote from the underlag file: its file source is dropped.
  const prev = got.value;
  const underlag = prev.underlag
    ? {
        ...prev.underlag,
        fieldSources: Object.fromEntries(
          Object.entries(prev.underlag.fieldSources).filter(
            ([field]) => JSON.stringify(input[field as keyof DemoCaseInput]) === JSON.stringify(prev.input[field as keyof DemoCaseInput]),
          ),
        ),
      }
    : undefined;
  const record: DemoCase = { ...prev, input, underlag, status: 'DRAFT', proposal: undefined, approval: undefined, updatedAt: new Date().toISOString() };
  saveCase(record);
  return { ok: true, value: record };
}

export async function proposeCase(user: AuthUser, id: string, reopen = false): Promise<Result<DemoCase>> {
  const got = access(id, user);
  if (got.ok === false) return got;
  const guard = await guardApproved(user, got.value, reopen, 'nytt förslag');
  if (guard.ok === false) return guard;
  const input = got.value.input;
  const facts = await readLayerFacts(input.propertyDesignation);
  const citations = await citeMpfCodes(input.verksamhetskoder);
  const requirements = loadRequirements();
  const rows = buildProposalRows({
    input,
    underlag: got.value.underlag,
    localization: localizationRows(facts),
    citations,
    requirements: requirements.rows,
    coverage: requirements.coverage,
    municipality: facts.municipality,
  });
  const record: DemoCase = {
    ...got.value,
    status: 'PROPOSED',
    approval: undefined,
    updatedAt: new Date().toISOString(),
    proposal: {
      generatedAt: new Date().toISOString(),
      rows,
      inputs: {
        requirements: requirements.status,
        localizationLabel: LOCALIZATION_LABEL,
        legalCorpusCaveat: citations[0]?.caveat ?? '',
      },
    },
  };
  saveCase(record);
  return { ok: true, value: record };
}

export async function approveCase(user: AuthUser, id: string, decisions: RowDecision[]): Promise<Result<DemoCase>> {
  const got = access(id, user);
  if (got.ok === false) return got;
  if (got.value.status !== 'PROPOSED' || !got.value.proposal) return { ok: false, status: 409, error: 'no_open_proposal' };
  let frozen: ReturnType<typeof freezeApproval>;
  try {
    frozen = freezeApproval(got.value, decisions, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Decision errors are the user's to fix (e.g. undecided rows); report them verbatim.
    if (/^(undecided_rows|duplicate_decision|decision_for_unknown_row|empty_edit|proposal_guardrail_violation)/.test(message)) {
      return { ok: false, status: 422, error: message };
    }
    throw error;
  }
  await auditTrail.logAction(
    reference(id),
    'APPROVAL_GRANTED',
    'Document',
    id,
    user.id,
    `DEMO-01: förslag godkänt radvis av användaren; fryst JSON sha256 ${frozen.sha256}`,
    {
      userRole: user.role,
      details: {
        frozenSha256: frozen.sha256,
        releaseSha: frozen.releaseSha,
        approvedRows: frozen.rows.length,
        struckRows: frozen.struckRowIds.length,
        editedRows: decisions.filter((d) => d.action === 'edit').length,
      },
    },
  );
  const record: DemoCase = {
    ...got.value,
    status: 'APPROVED',
    updatedAt: new Date().toISOString(),
    approval: {
      approvedAt: frozen.approvedAt,
      approvedByUserId: user.id,
      frozenSha256: frozen.sha256,
      frozenPath: frozen.path,
      releaseSha: frozen.releaseSha,
    },
  };
  saveCase(record);
  return { ok: true, value: record };
}

export async function casePdf(user: AuthUser, id: string, kind: 'anmalan' | 'egenkontroll'): Promise<Result<{ buffer: Buffer; filename: string }>> {
  const got = access(id, user);
  if (got.ok === false) return got;
  const approval = got.value.approval;
  if (got.value.status !== 'APPROVED' || !approval) return { ok: false, status: 409, error: 'not_approved' };
  // The PDF is built from the frozen file, re-hashed on read; the live case is not used.
  const { document } = loadFrozen(approval.frozenSha256);
  const frozen = document as FrozenProposal;
  const buffer = kind === 'anmalan' ? await renderAnmalanPdf(frozen, approval.frozenSha256) : await renderEgenkontrollPdf(frozen, approval.frozenSha256);
  await auditTrail.logAction(reference(id), 'DATA_EXPORTED', 'Document', id, user.id,
    `DEMO-01: PDF ${kind === 'anmalan' ? 'C-anmälan – förslag, ej inlämnad' : 'Egenkontrollprogram – förslag'} ur fryst JSON ${approval.frozenSha256}`,
    { userRole: user.role, details: { frozenSha256: approval.frozenSha256, kind } });
  return { ok: true, value: { buffer, filename: `demo01-${kind}-forslag-${approval.frozenSha256.slice(0, 12)}.pdf` } };
}

export async function caseAuditTrail(user: AuthUser, id: string) {
  const got = access(id, user);
  if (got.ok === false) return got;
  return { ok: true as const, value: await getAuditTrail(reference(id)) };
}

/** An attachment image of this case, hash-checked on read (only hashes listed in the case's underlag). */
export function caseAttachment(user: AuthUser, id: string, digest: string): Result<{ buffer: Buffer; mime: string }> {
  const got = access(id, user);
  if (got.ok === false) return got;
  const ref = got.value.underlag?.attachments?.find((a) => a.sha256 === digest);
  if (!ref) return { ok: false, status: 404, error: 'attachment_not_in_case' };
  return { ok: true, value: { buffer: loadBlob(ref.sha256, ref.mime), mime: ref.mime } };
}
