/**
 * W-M2d item 4 (owner 2026-10-02 night), moved out of LuWorkspace.tsx by W-M2e item 2 so the error-code
 * inventory test can read it: the Swedish line of one machine notice of a reproducibility check
 * (LuReExecutionResult.notices), shown directly under the result. Codes stay in the technical section.
 *
 * NOT_CHECKED_CAUSE_NOT_PINNED: the layer's NOT_CHECKED finding was reproduced, but its stored cause was
 * never pinned and cannot be reproduced.
 *
 * W-UI1 (A; U30R6 K9/K12): LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY -- the PASS rests on an older, unbound
 * artifact form; its line is the owner's exact text (consistency only; authenticity and current authority
 * are not verified). luVerifyPresentation.ts makes it the head of the result and never shows it green.
 */

import { governedCheckLabelSv } from './luControlChecks';

/** W-M2d item 4 / W-UI1: one machine notice of a verification (LuReExecutionResult.notices), own fields only. */
export type LuVerifyNotice = {
  readonly code: string;
  readonly finding_ids: readonly string[];
  /** W-UI1 (K9): the legacy notice's basis (V1_FORM | LEGACY_UNBOUND) and its own fields, kept as sent. */
  readonly basis?: string;
  readonly text_sv?: string;
  readonly authenticity_verified?: boolean;
  readonly current_authority_verified?: boolean;
};

const NOT_CHECKED_FINDING_PREFIX = 'finding-notchecked-';

/** The line for a notice code this UI has no text of its own for. */
export const LU_VERIFY_NOTICE_UNKNOWN_SV = 'Kontrollen gav en notis som inte kan visas här – se teknisk information.';

/** The owner's exact text (2026-10-02) for a PASS over an older, unbound artifact form. */
export const LU_VERIFY_NOTICE_LEGACY_UNBOUND_FORM_SV =
  'Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade.';

const VERIFY_NOTICE_TEXT: Readonly<Record<string, (notice: LuVerifyNotice) => string>> = {
  NOT_CHECKED_CAUSE_NOT_PINNED: (notice) => {
    const layers = notice.finding_ids
      .filter((id) => id.startsWith(NOT_CHECKED_FINDING_PREFIX))
      .map((id) => governedCheckLabelSv(id.slice(NOT_CHECKED_FINDING_PREFIX.length)));
    const which = layers.length === 0 ? 'ett eller flera lager' : layers.length === 1 ? `lagret ${layers[0]}` : `lagren ${layers.join(', ')}`;
    return `Orsaken till att ${which} inte kontrollerades sparades inte vid bedömningen och kan inte återskapas.`;
  },
  // W-UI1: the UI's own copy of the owner's text -- never the server's text_sv echoed unchecked.
  LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY: () => LU_VERIFY_NOTICE_LEGACY_UNBOUND_FORM_SV,
};

/** W-M2e item 2 (inventory): the notice codes with a text of their own. */
export const LU_VERIFY_NOTICE_TEXTS: readonly string[] = Object.freeze(Object.keys(VERIFY_NOTICE_TEXT));

export function presentLuVerifyNotice(notice: LuVerifyNotice): string {
  const text = Object.prototype.hasOwnProperty.call(VERIFY_NOTICE_TEXT, notice.code) ? VERIFY_NOTICE_TEXT[notice.code] : undefined;
  return text ? text(notice) : LU_VERIFY_NOTICE_UNKNOWN_SV;
}
