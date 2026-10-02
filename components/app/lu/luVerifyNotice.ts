/**
 * W-M2d item 4 (owner 2026-10-02 night), moved out of LuWorkspace.tsx by W-M2e item 2 so the error-code
 * inventory test can read it: the Swedish line of one machine notice of a reproducibility check
 * (LuReExecutionResult.notices), shown directly under the result. Codes stay in the technical section.
 *
 * NOT_CHECKED_CAUSE_NOT_PINNED: the layer's NOT_CHECKED finding was reproduced, but its stored cause was
 * never pinned and cannot be reproduced.
 */

import { governedCheckLabelSv } from './luControlChecks';

/** W-M2d item 4: one machine notice of a verification (LuReExecutionResult.notices). */
export type LuVerifyNotice = { readonly code: string; readonly finding_ids: readonly string[] };

const NOT_CHECKED_FINDING_PREFIX = 'finding-notchecked-';

/** The line for a notice code this UI has no text of its own for. */
export const LU_VERIFY_NOTICE_UNKNOWN_SV = 'Kontrollen gav en notis som inte kan visas här – se teknisk information.';

const VERIFY_NOTICE_TEXT: Readonly<Record<string, (notice: LuVerifyNotice) => string>> = {
  NOT_CHECKED_CAUSE_NOT_PINNED: (notice) => {
    const layers = notice.finding_ids
      .filter((id) => id.startsWith(NOT_CHECKED_FINDING_PREFIX))
      .map((id) => governedCheckLabelSv(id.slice(NOT_CHECKED_FINDING_PREFIX.length)));
    const which = layers.length === 0 ? 'ett eller flera lager' : layers.length === 1 ? `lagret ${layers[0]}` : `lagren ${layers.join(', ')}`;
    return `Orsaken till att ${which} inte kontrollerades sparades inte vid bedömningen och kan inte återskapas.`;
  },
};

/** W-M2e item 2 (inventory): the notice codes with a text of their own. */
export const LU_VERIFY_NOTICE_TEXTS: readonly string[] = Object.freeze(Object.keys(VERIFY_NOTICE_TEXT));

export function presentLuVerifyNotice(notice: LuVerifyNotice): string {
  const text = Object.prototype.hasOwnProperty.call(VERIFY_NOTICE_TEXT, notice.code) ? VERIFY_NOTICE_TEXT[notice.code] : undefined;
  return text ? text(notice) : LU_VERIFY_NOTICE_UNKNOWN_SV;
}
