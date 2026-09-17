# COLD AUDIT 04D-R1-F04 — authority evidence integrity and execution replay binding

Status: ATTACK TESTS PENDING

Audit base: `abe09effc6d685058f0f13bbe9ac74b1fae94e16`

## Hypothesis F04-A — verified decision + mutated evidence body

A legitimate `VerifiedLuSourceAuthorityDecision` may remain WeakSet-approved while a caller supplies an altered `LuSourceAuthorityEvidenceArtifact` body that keeps the original `artifact_id` and `content_hash`. Persistence must recompute/validate the evidence body at the persistence boundary and reject this.

Expected result: REJECT before any authority-evidence or assessment write.

## Hypothesis F04-B — verified authority replayed onto another execution

A legitimate verified authority decision/evidence minted for execution A must not authorize persistence of an assessment whose outcome belongs to execution B. Persistence must resolve the assessment outcome -> attempt -> manifest and require the manifest's `execution_identity_ref` to equal the verified decision subject ref.

Expected result: REJECT before assessment write.

No 04D-R1 approval is granted until both attacks are executable and fail closed.
