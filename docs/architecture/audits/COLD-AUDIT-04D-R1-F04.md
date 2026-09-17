# COLD AUDIT 04D-R1-F04 — authority evidence integrity and execution replay binding

Status: **INDEPENDENT RED/GREEN EXECUTED — TRUSTED DEV-GOV PENDING**

Audit base: `abe09effc6d685058f0f13bbe9ac74b1fae94e16`

Corrected audit candidate before trusted-unit commit: `1f97446ea2661e23b58d801717d8343d4d1062fe`

## F04-A — verified decision + mutated evidence body

A legitimate `VerifiedLuSourceAuthorityDecision` remained WeakSet-approved while a caller supplied an altered `LuSourceAuthorityEvidenceArtifact` body retaining the original `artifact_id` and `content_hash`.

Independent RED execution: GitHub CI run `35174624648`, Typecheck job `105053482237`. The attack promise **resolved instead of rejecting**, proving the original 04D-R1 persistence boundary accepted the mutated evidence body.

Correction: persistence now recomputes the hash of the actual presented AuthorityEvidence body, excluding only its declared `content_hash`, and rejects `authority_evidence_body_hash` before any authority or assessment write.

Independent GREEN execution: GitHub CI run `35174640461`, Typecheck job `105053528172`. The F04 test file reported **2 passed (2)** before the repository-wide `tsc --noEmit` subsequently failed on unrelated pre-existing type errors.

## F04-B — verified authority replayed onto another execution

A legitimate verified authority decision/evidence minted for execution A was replayable onto a newly constructed canonical assessment whose valid outcome belonged to execution B.

The same RED run proved the replay was accepted: the promise resolved with a `LOCALIZATION_ASSESSMENT` instead of rejecting.

Correction: persistence now resolves `outcome -> attempt -> manifest -> execution_identity_ref` and requires that identity reference to equal the verified authority decision's `subject_ref`. Resolution failure or mismatch rejects `authority_execution_identity_binding` before persistence.

The same GREEN run proves the corrected boundary rejects the replay attack.

## Trusted proof contract

`governance/devgov/units/lu-source-authority-wiring-04d-r1-f04-v1.json` freezes the two findings as independent RED/GREEN proof IDs:

- `f04-evidence-body-integrity`
- `f04-execution-identity-binding`

The exact RED base remains `abe09effc6d685058f0f13bbe9ac74b1fae94e16`. 04D-R1 is not promoted to PROVEN until the trusted Dev-Gov execution and canonical evidence gate verify the corrected candidate SHA.
