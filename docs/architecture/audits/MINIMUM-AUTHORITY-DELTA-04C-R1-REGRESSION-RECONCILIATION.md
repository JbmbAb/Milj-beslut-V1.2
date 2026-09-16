# MINIMUM-AUTHORITY-DELTA-04C-R1 — Authority Regression Reconciliation

**Status:** IMPLEMENTED / UNPROVEN  
**Base:** 04C candidate `09af70554fe9b41eee856d62df6e3bd94a276a32`

## Purpose

Reconcile the pre-04C authority regression tests with the canonical trust model proven by 04C,
without changing production semantics.

RV7 confirmed all three RV6 findings closed, then found two residual test regressions:

1. `ACT_21_I3_I5.authority.test.ts` still constructed the old pre-04C fields
   `root_actor_ref`, `root_actor_hash`, and `trust_domain_ref`.
2. `AuthorityVerification.test.ts` expected stale wording for a scope rejection that now
   fail-closes earlier at the trust-root/domain/scope closure check.

## Frozen boundary

04C-R1 is test reconciliation only.

It SHALL NOT modify:

- ACT-21 validators;
- governance runtime implementation;
- Actor/Trust/AuthorityEvidence artifacts;
- LU authority implementation;
- server/product wiring;
- ADR-24-21.

If a test cannot be reconciled without production-code changes, this delta SHALL stop rather than
change semantics.

## ACT-21-I3 semantic reconciliation

The old 03A test assumed that a non-root Actor with zero trust-domain references must fail.

That is no longer the frozen 04C contract. ADR-24-21 says an Actor MAY participate in multiple trust
domains, and 04C intentionally models `trust_domain_refs[]` as zero-or-more. Authority evaluation,
not Actor existence, requires one selected trust domain.

The reconciled test therefore proves:

- explicit resolvable participation passes;
- zero memberships are permitted;
- duplicate canonical domain refs fail closed;
- unresolved declared domain refs fail closed;
- absence of any Actor fails instead of vacuously passing.

Root hash binding remains tested under ACT-21-I5, where that invariant belongs.

## ACT-21-I5 regression preservation

The existing graph properties remain unchanged and must all stay load-bearing:

- unique acyclic root path passes;
- overlapping multiple root paths fail;
- non-overlapping historical/future paths pass;
- root-reachable active cycle fails;
- temporally non-overlapping return edge does not create a false cycle;
- empty trust-domain corpus fails;
- root-hash mismatch fails closed.

Only the fixtures move to canonical 04C fields:
`root_binding_type`, `root_ref`, `root_hash`, `anchor_hash`.

## Runtime assertion reconciliation

A requested scope that differs from `TrustDomain.authority_scope` now fails at the combined
domain/anchor/root closure guard and returns `REJECT_TRUST_ROOT`. The regression test now asserts
that stable fail-closed classification instead of stale wording.

## Proof target

RED and GREEN run the same broad authority regression corpus. RED is the exact 04C base and MUST
fail because these legacy tests are stale. GREEN is the 04C-R1 candidate and MUST pass without any
production-code change.

A trusted GREEN proves only regression reconciliation. It does not prove LU production
AuthorityEvidence wiring; that remains the next 04D delta.
