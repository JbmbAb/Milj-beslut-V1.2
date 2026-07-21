# Permit Portal — legacy och arv till C-anmälan

## Bakgrund

`PermitPortalView` och läget `PERMIT_PORTAL` var plattformens **ursprungliga monolitiska C-anmälan** (SNI/EWC, MPF-profil, kravchecklista, kartläge) innan modulär uppdelning 2026.

Moduläriseringen gav tre canonical produktflöden under `Core_WORKFLOW`:

| Modul | UI | API |
| ----- | -- | --- |
| C-anmälan schaktmassor | `CNotificationMassUI.tsx` | `/api/c-notification/mass/*` |
| Enskilt avlopp | `SewagePortalView.tsx` | `/api/sewage/*` |
| Lokaliseringsutredning | `LocalizationStudyUI.tsx` | `/api/localization/*` |

**C-anmälan kemikalier** (`CNotificationUI.tsx`) är en separat produktmodul.

## Vad som flyttades

| Ursprung (Permit Portal) | Canonical idag |
| ------------------------ | -------------- |
| SNI/EWC-kodväljare | `POST /api/c-notification/mass/validate-codes` |
| MPF-profil | `massOrchestrator` + `mpfThresholdService` |
| Mellanlagring/deponi/massflöde | `massOrchestrator` |
| Export & submission | `POST /api/c-notification/mass/submit` |
| Audit trail | `GET /api/c-notification/mass/:caseId/audit-trail` |
| Staging-E2E | `tests/e2e/staging-c-anmalan-mass.spec.ts` |

## Vad som är kvar (legacy)

| Fil | Status |
| --- | ------ |
| `components/PermitPortalView.tsx` | `@deprecated` — kart-/provningsyta, apply-logik pekar användare till mass-modulen |
| `components/PermitPortalApplyPanel.tsx` | **Borttagen** — duplicerade apply-läge |
| `components/PermitPortalMapPanel.tsx` | **Borttagen** — duplicerade map-läge |
| `services/projectStructure.ts` | **Behålls** — delad MPF/gate-logik för projektplan |
| `PERMIT_PORTAL` (InterfaceMode) | Legacy läge; hubben "Ansökan" öppnar `Core_WORKFLOW` → C-anmälan mass |

## Riktlinjer för utvecklare

1. **Ny C-anmälan-funktionalitet** → `server/modules/c-notification-mass/` + `CNotificationMassUI.tsx` only.
2. **MPF/EWC-regler** → `mpfThresholdService.ts` / `projectStructure.ts` (dela, duplicera inte).
3. **Lägg inte till nya API-anrop från `PermitPortalView`** — migrera till mass-modulen.
4. **Admin tillståndsportal** (`components/admin/modules/permit-portal/`) är AI-generator för miljötillstånd — **inte** samma som legacy Permit Portal / C-anmälan mass.

## Referenser

- `docs/qa/MODULE_IMPLEMENTATION_PLAN.md`
- `docs/architecture/modulregister_ombyggnad.md`
- `docs/qa/FAS2_STAGING_EVIDENCE.md`
