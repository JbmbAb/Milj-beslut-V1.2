# ADR — Chunking Subsystem

## Status
Accepted

## Decision
One chunking subsystem (`@miljobeslut/mps-chunking`), **multiple domain-specific chunk contracts**.

Shared: types, versioning namespaces, SHA-256 hashing, manifests, verifiers, determinism/replay tests, `source_artifact_ref`.

Separated:

| Contract | Package path | Version | Invariant |
|---|---|---|---|
| Text structure (RAG/evidence) | `src/text/` | `text/v2.3` | Semantic boundaries + overlap |
| Archive bytes (MB-005) | `src/archive/` | `archive/v1.0` | Fixed byte ranges, no decode |

## Non-decision
No `UniversalChunker` with semantic/byte modes. Modes mix incompatible invariants.

## Package
`packages/mps-chunking`
