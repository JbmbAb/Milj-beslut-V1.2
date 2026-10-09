# Canonical Project Context READ

**Status:** package boundary extracted (`rt/mcp-canonical-read-extraction-01`)

## Flow

```text
consumer (product / future MCP gateway)
  → reusable mps-lu CanonicalProjectContextReader
  → injected ProjectContextBindingIndexPort (read-only)
  → ArtifactRepositoryPort (CAS resolve only)
  → injected ProjectContextBindingAuthorityPort
      (existing issuer verifier — same semantics as product)
  → verified CanonicalProjectContext
```

## Explicit non-goals

| Concern | Status |
| --- | --- |
| READ ONLY | YES |
| NO MINT | YES |
| NO BOOTSTRAP | YES |
| NO POSTGIS | YES |
| NO SPATIAL PROVIDER | YES |
| NO RAW SQL in reusable reader | YES |
| NO NEW AUTHORITY / signer / trust root | YES |

## Shared semantics

The Mimer product wrapper `src/application/resolveCanonicalProjectContext.ts` and any
future MCP gateway **must** consume this same package reader. There is one canonical
implementation of verified project-context read.

Authority is established elsewhere (owner bootstrap / binding issuance). This code only
reads and verifies already-established authority.
