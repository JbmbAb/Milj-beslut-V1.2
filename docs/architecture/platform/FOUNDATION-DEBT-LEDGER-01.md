# FOUNDATION-DEBT-LEDGER-01
**SYFTE:** Spåra teknisk skuld, redundanta exekveringsvägar och brister i plattformens fundament som hotar reproducerbarhet (Clean Path) eller oberoende granskning.

| ID | Finding | Affected LU Stage | Severity | Blocks LU? | Blocks External Review? | Canonical Replacement | Evidence | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **FD-001** | Saknad livscykel för temporära resurser (35 GB skräpdata, 112 worktrees, 7 dolda checkouts) | PROJECT CONTEXT / AUDIT | HIGH | NO | YES | Deterministisk `Clean Checkout` med strikt TTL | STORAGE-PRESSURE-001 | OPEN |
| **FD-002** | Migration causality regrade (Historik och beroenden i databas drifter) | ALLA | HIGH | YES (på sikt) | YES | Reproducible Clean Install | (Tidigare audits) | OPEN |
| **FD-003** | Legacy E2E admin project path | LU INITIALIZATION | MED | NO | YES | Canonical LU Path | LU-CANONICAL-PATH-01 | OPEN |
