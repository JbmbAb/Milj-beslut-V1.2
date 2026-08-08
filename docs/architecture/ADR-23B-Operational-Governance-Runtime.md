# ADR-23B: Operational Governance Runtime

## Status
Accepted (runtime boundary only)

## Context
Frozen Core (VIEW-22 / PROOF-22 types, ProofPathResolver, ViewerKernel gates) is sealed.
Phase 23B wires those into a **runnable observation runtime** without minting authority.

## Decision
Package `@miljobeslut/mps-governance-runtime` is the sole operational facade for:

1. Admit exactly one `ViewerCapabilityArtifact` (VIEW-22-I2, I6)
2. Open / inspect / export / close `AuditSessionArtifact` (VIEW-22-I4, I5)
3. Session-bound proof path resolution via existing `ProofPathResolver` + budget
4. Reject observation writes of authority artifact types (GOVERNANCE-22.9-I13)

## Non-goals
- No new domains, LU/GIS, CAS truth mutation, or Frozen Core identity changes
- Audit sessions are ephemeral records, never release roots

## Package
`packages/mps-governance-runtime`
