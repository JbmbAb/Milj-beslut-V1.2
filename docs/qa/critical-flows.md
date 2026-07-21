# Critical Flows (Production Gate)

This file defines the minimum module-specific flows that must be validated before merge.

## Shared prerequisite - Admin login and active project

- Precondition: `ADMIN_CONSOLE_PASSWORD` is configured.
- Steps:
  1. Open the landing page.
  2. Sign in through Admin Console.
  3. Create or select an active project.
- Expected:
  - Access token and refresh token are returned.
  - Active project ID is available to downstream module flows.

## Flow 1 - Lokaliseringsutredning

- Precondition: Logged in admin + active project + live GIS integrations.
- Steps:
  1. Search/select property and open map context.
  2. Choose one or more site alternatives.
  3. Run localization analysis.
  4. Review risk/rule result and generate decision support.
- Expected:
  - Alternatives are analyzed against live data sources.
  - Result contains traceable risk/rule basis and can be exported.
  - Audit trail is created for critical analysis steps.

## Flow 2 - C-anmälan

- Precondition: Logged in admin + active project + module data sources available.
- Steps:
  1. Create or open a C-anmälan case.
  2. Complete classification/requirement steps for the activity.
  3. Generate the case basis and submission/export material.
  4. Verify submission-ready state or tracked export result.
- Expected:
  - Case data is persisted without fallback/demo mode.
  - Requirement and submission state are traceable per project.
  - Audit trail is created for submission-relevant steps.

## Flow 3 - Enskilt avlopp

- Precondition: Logged in admin + active project or application context.
- Steps:
  1. Create a sewage application with property and coordinates.
  2. Validate mandatory fields and coordinate rules.
  3. Move status through review/decision.
  4. Export supporting material.
- Expected:
  - Application persists with valid status transitions.
  - Validation rejects incomplete or invalid input.
  - Export and audit trail remain traceable.

## Human-in-the-loop requirement

- Any legal/compliance interpretation produced by AI must be reviewed and approved by a human reviewer before release.
