# Critical Flows (Production Gate)

This file defines the minimum critical user/business flows that must be validated before merge.

## Flow 1 - Admin login

- Precondition: `ADMIN_CONSOLE_PASSWORD` is configured.
- Steps:
  1. Open app landing page.
  2. Enter admin username and password in Admin Console.
  3. Submit login.
- Expected:
  - Access token and refresh token are returned.
  - Admin session can call protected endpoints.

## Flow 2 - Project create/select

- Precondition: Logged in as admin.
- Steps:
  1. Open project list.
  2. Create a project with a designation.
  3. Select project as active.
- Expected:
  - Project is persisted and selectable.
  - Active project ID is used in downstream operations.

## Flow 3 - Project plan load/save

- Precondition: Active project + valid token.
- Steps:
  1. Load `/api/projects/:projectId/plan`.
  2. Update plan payload.
  3. Save `/api/projects/:projectId/plan/save`.
  4. Reload plan.
- Expected:
  - Saved values roundtrip without data loss.
  - Persisted plan is returned on subsequent load.

## Flow 4 - Template apply + stage gate evaluate

- Precondition: Active project + valid token.
- Steps:
  1. Apply template (`/template/apply`).
  2. Evaluate stage gate (`/stage-gates/:gateId/evaluate`) twice with same input.
- Expected:
  - First evaluation can change gate and plan state.
  - Second identical evaluation is idempotent.

## Flow 5 - Carbon calculate + persistence

- Precondition: Active project + valid token.
- Steps:
  1. Submit carbon input (`/carbon/calculate`).
  2. Save plan.
  3. Reload plan.
- Expected:
  - Carbon result exists in `plan.carbonSummary.lastResult`.
  - Carbon history is retained.

## Human-in-the-loop requirement

- Any legal/compliance interpretation produced by AI must be reviewed and approved by a human reviewer before release.
