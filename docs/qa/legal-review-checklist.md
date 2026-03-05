# Legal Review Checklist (Mandatory Before Merge)

Reviewer must sign off each item in PR.

## Security and privacy

- [ ] JWT secrets and admin credentials are not hardcoded.
- [ ] Protected endpoints require valid auth token.
- [ ] Role-based access control is validated for sensitive routes.
- [ ] No unauthorized cross-organization data access is possible.
- [ ] Logs and audit output do not expose unnecessary personal data.

## Legal and compliance

- [ ] Data minimization is respected in API responses.
- [ ] Property and audit access is purpose-bound and traceable.
- [ ] AI generated conclusions are marked as draft and require human review.
- [ ] Retention and audit chain behavior remains intact.

## Operational quality

- [ ] Critical flows from `docs/qa/critical-flows.md` are validated.
- [ ] Unit + integration + E2E suites pass for this PR.
- [ ] Smoke script `scripts/smoke-project-plan.ps1` remains executable.

## Sign-off

- Reviewer name:
- Date (YYYY-MM-DD):
- Decision: Approve / Reject
- Notes:
