# Core Scope Lock — Revision Draft (2026-08-30)

**APPROVAL STATUS: DRAFT — PENDING OWNER APPROVAL.**
[core-scope-lock.md](./core-scope-lock.md) (v1.0, 2026-03-02) **remains the current authority**
until this revision is explicitly approved by the owner and the two files are re-pointed. This
draft does not itself change scope, capability boundaries, or Core/V2+ classification — it only
proposes updating the *vocabulary* the lock is written in, per owner direction
(DOCUMENTATION_FINAL_NORMALIZATION, 2026-08-30): "terminology drift, NOT scope breach."

**References previous lock:** [core-scope-lock.md](./core-scope-lock.md), `Ref:
Core_SCOPE_LOCK_V1_2026-03-02`.

**Proposed supersession date:** to be set at the moment of owner approval — not yet in effect.

**Owner approval:** _______________ (name, date) — **not yet signed**.

## Why a revision is proposed

D8 currency check (2026-08-30) found `core-scope-lock.md`'s three Core (P0) items are still
substantively correct, but written in March 2026 vocabulary that predates today's concrete module
organization. Classification: `PARTIALLY_DIVERGED` (terminology drift, not scope breach) — no Core
item has been abandoned, and no out-of-scope item has silently entered Core.

## Vocabulary mapping: old lock → current module vocabulary

| Old lock item (2026-03-02) | Current module(s) realizing it | Notes |
| --- | --- | --- |
| 1. Ansökningsportal (permit-kodval, kravlista, utkast med manuell verifiering) | **C-anmälan / schaktmassor** (`server/modules/c-notification-mass/`) + **Enskilt avlopp** (`server/routes/sewage.routes.ts` + `sewageApplicationService.ts`) | Both are concrete "application portal" flows per `MODULE_IMPLEMENTATION_PLAN.md`. Explicitly **NOT** `docs/PERMIT_APPLICATION_GENERATOR.md`'s generic AI generator — that is a separate, out-of-scope module per D5 code-verification and `docs/architecture/PERMIT_PORTAL_LEGACY.md`. |
| 2. Projektledning (WBS-liknande struktur, tidslinje/Gantt, stage gates, audit trail) | **No direct current-module match found.** | Genuine gap, not silently resolved here — flagged for owner. Audit-trail behavior exists piecemeal inside individual module flows (e.g. C-anmälan, Enskilt avlopp both list "audit" in their flow), but no standalone WBS/Gantt/stage-gate project-management capability was found as a distinct current module. |
| 3. Säkerhetsgrunder (auth/RBAC, revisionslogg, grundläggande skyddskrav) | Cross-cutting platform layer, not a named product module | Unchanged — remains a platform-level Core requirement, not mapped to a single vertical. |
| (not previously named) | **Lokaliseringsutredning (LU)** — `server/services/localization.routes.ts`, `components/LocalizationStudyUI.tsx` | LU did not appear in the 2026-03-02 lock by name. It is upstream of / feeds into the application flows above (platsval → geodata → regel/risk → beslutsunderlag) rather than being itself an "Ansökningsportal." Whether LU is Core or a distinct P0 item is an **open scope question for owner** — this draft does not decide it. |

## V2+ boundary — retained unchanged

No new information from this pass changes the V2+ exclusions. Carried forward verbatim from
[core-scope-lock.md](./core-scope-lock.md):

1. Fullt logistikflöde som kommersiell standardmodul.
2. Grönkoll/finansiell taxonomi som produktkrav för Core.
3. Externa avtalsspärrade integrationer (BankID, Lantmäteriet premiumupplägg).

Cross-check against D5 code-verification (2026-08-30): `docs/GREEN_CHECK_GENERATOR.md`,
`docs/PERMIT_APPLICATION_GENERATOR.md`, and `docs/SOURCE_TRACING_GUIDE.md` all describe
real, tested, but explicitly out-of-Core backend modules — consistent with exclusions 1 and 2
above. No divergence found on the V2+ side.

## What this draft does NOT do

- Does not change what is in or out of Core.
- Does not resolve the "Projektledning" mapping gap or the "is LU Core" question — both are
  genuine open items for owner, not filled in by inference here.
- Does not supersede `core-scope-lock.md`. That file remains sole authority until this draft (or
  a revised version of it) is explicitly approved.

## Closure checklist status (this item only)

- [x] refreshed scope-lock drafted, explicitly marked non-authoritative until approved
- [x] old/current vocabulary mapping documented
- [x] V2+ boundary carried forward explicitly, cross-checked against D5 findings
- [ ] owner approval — pending
- [ ] supersession — not yet in effect
