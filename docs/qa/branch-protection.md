# Branch Protection and Merge Gates

Enable branch protection on the default branch with these required checks:

1. Required status checks

- `Typecheck`
- `Lint`
- `Format check`
- `Unit tests`
- `Integration tests`
- `Build`
- `E2E tests`

2. Pull request requirements

- Require at least 1 approving review.
- Require review from Code Owners.
- Dismiss stale approvals on new commits.

3. Human-in-the-loop controls

- PR must include completed legal checklist from `docs/qa/legal-review-checklist.md`.
- PR must reference validation of `docs/qa/critical-flows.md`.

4. Merge policy

- No direct pushes to protected branch.
- No merge when any required check fails.
