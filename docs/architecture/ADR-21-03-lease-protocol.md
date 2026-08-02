# ADR-21-03: Lease Protocol

## Status
Accepted (Paket 21 Prerequisites)

## Context
An interface for leasing is insufficient to guarantee exclusive execution rights across a distributed system. A formal protocol with a deterministic state machine is required so that `LeaseCoordinator` implementations operate predictably.

## Decision
The Lease lifecycle is governed by a strict state machine with deterministic transitions and strong exclusivity guarantees.

### Normative Rules

1. **Lease State Machine Transitions:**
   - `AVAILABLE` &rarr; `LEASED`
   - `LEASED` &rarr; `HEARTBEATING`
   - `HEARTBEATING` &rarr; `EXPIRED`
   - `EXPIRED` &rarr; `RECOVERED`
   - `RECOVERED` &rarr; `AVAILABLE`

2. **Exactly one worker may hold a lease.**
3. **Expired leases SHALL become reclaimable.**
4. **Lease renewal SHALL be monotonic.**
5. **Lease expiration SHALL be deterministic.**

## Consequences
- Prevents split-brain scenarios where multiple workers attempt to execute the same plan.
- Guarantees that stalled or crashed workers do not permanently lock resources.
