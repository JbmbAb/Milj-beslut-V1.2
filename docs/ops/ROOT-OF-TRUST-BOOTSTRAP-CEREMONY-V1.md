# Root Of Trust Bootstrap Ceremony V1

This document is descriptive, not normative. Canonical code and executed proof
remain authoritative if they differ from this document.

## Clean-Room Contract

A clean-room verification environment consists of a fresh checkout, an empty
private secrets root, canonical public trust seeds, and explicit non-secret
runtime prerequisites. Private keys are created only by the bootstrap nodes
that own them; public-only verification never requires a private key.

## Dependency Graph

| Node | State | Private storage | Runtime prerequisite |
| --- | --- | --- | --- |
| A ceremony keypairs | active | explicit `--secrets-root` | none |
| Viewer authority | active | explicit `--secrets-root` | explicit `--mimers-root`, admitted release and binding refs |
| B LU root to issuer | active | explicit `--secrets-root` | explicit `--mimers-root` |
| C Source Registry | active | none | trusted public-key seed and unchanged registry bytes |
| Legal corpus signing | dormant | none | not provisioned by this ceremony |

The Viewer node is not a filesystem-only node. Its input references name
already-admitted non-secret runtime state; the ceremony never substitutes the
legacy ORSA values when clean-room mode is selected.

Viewer `owner_authority_ref` remains a known simplification; this ceremony
preserves that existing reference contract and does not strengthen it.

## Ordering

1. Verify the Source Registry with `SOURCE_REGISTRY_TRUSTED_KEYS_FILE` set to
   the canonical public seed.
2. Preflight every active private-key target before any key is generated.
3. Bootstrap A, then B, then the Viewer node against their explicit roots.
4. Reopen with public material only and verify each applicable trust chain.
5. A second execution must deny without changing existing key bytes.

Rotation and recovery are excluded. An existing complete or partial keypair is
an operator-visible denial, never an implicit replacement.

## Execution

The D harness is `scripts/ops/global-c1-clean-room-ceremony-v1.ts`. It refuses
to write unless `--execute` is present and requires explicit values for the
private secrets root, Mimer root, A/B key IDs, Viewer subject inputs, registry
path, and the public trust seed. A clean-room command therefore never falls
back to legacy ORSA references or a developer's `~/.mimers` roots.

`SOURCE_REGISTRY_TRUSTED_KEYS_FILE` may point at the same committed seed for
other verify-only consumers. D receives that seed explicitly through
`--source-registry-trusted-keys-file`; no Source Registry private key is an
input to the ceremony.
