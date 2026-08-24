# SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-V1 — STOP: single-key verification model (read-only record)

```
Document class:    GOVERNANCE DECISION RECORD (read-only)
Program parent:    LU-PROPERTY-BOUND-DOCUMENT-VERTICAL-V1
Status:            STOPPED — no key generated, no env provisioned, no registry state touched.
                    Owner decision pending: SOURCE_REGISTRY_KEY_ROTATION_MODEL_GAP (2026-08-25).
```

## Why this unit was ordered

`MUNICIPAL-DECISION-SOURCE-ADMISSION-V1` (Falkenbergs kommun / Ullared 2:215) is blocked because
the real `source-registry-governor` private key that signed the existing
`domstolsverket-puh-mmod` Source Registry entry (`ed25519:source-registry-governor-2026-08-14`)
is not available to the current local runtime — confirmed absent from `.env.local`, `.env`, the
process environment, and `~/.mimers/secrets/` (which holds every other governance key minted
this session). No provisioning documentation exists either. This unit's mandate was to establish
a *new* governor authority as an explicit, owner-approved key-rotation event — not to approve
Falkenbergs kommun.

## What recon found

`packages/mps-data-governance/src/SourceRegistry.ts`:

- `loadVerifiedSourceRegistry()` resolves **exactly one** `VerificationKeyProvider` — either the
  one passed in, or `getSourceRegistryVerificationKeyFromEnv()` (a single
  `SOURCE_REGISTRY_SIGNING_KEY_ID` + `SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM` pair) — and verifies
  **every** entry in the registry array against that same single key, via
  `Promise.all(raw.map((entry) => verifySourceRegistryArtifact(entry, signing)))`.
- `Promise.all` has no partial-success mode: if verification of *any one* entry throws, the
  entire registry load throws, and `getSource()`/`isUrlAllowedForSource()` become unusable for
  every source, not just the one that failed.
- `verifySourceRegistryArtifact()`'s check list includes
  `['signer_key', attestation.signer === signing.keyId && predicate.signer_key_id === signing.keyId]`
  — an exact match against whichever single key was loaded. There is no fallback, no keyring, no
  "try each trusted key" logic.
- Repo-wide search for a multi-key concept (`trusted_signers`, `TRUSTED_KEYS`,
  `VerificationKeyProvider[]`, keyring) returned zero matches. No such mechanism exists anywhere
  in this codebase today.

## The concrete consequence

Rotating `SOURCE_REGISTRY_SIGNING_KEY_ID`/`SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM` to a new
governor key, as this unit was ordered to do, would not merely leave the old
`domstolsverket-puh-mmod` entry "historically valid but unapprovable for new sources" (the
intended successor-authority semantics). It would make that entry **fail verification outright**
on the very next registry load, because `attestation.signer` (the old key id) would no longer
equal `signing.keyId` (the new key id). Since a single failing entry fails the whole
`Promise.all`, this would break `loadVerifiedSourceRegistry()` for **every** source, including
the one every real proof from Unit A through Unit F this session (`00019927-5933-499c-9be1-98991ad31f2f`
promotion, deterministic projection, candidate, human verification, canonical DocumentEvidence,
H15 rehash) depends on being resolvable.

This is precisely the stop condition the order specified: *"If the current verifier only
supports one key and rotating would invalidate historical entries: STOP. Report
SOURCE_REGISTRY_KEY_ROTATION_MODEL_GAP. Do not replace the old key blindly."*

## What was NOT done (deliberately)

- No new Ed25519 governor key was generated.
- No `SOURCE_REGISTRY_SIGNING_*` env vars were set.
- No change was made to `source-registry/national-registry.json`.
- No change was made to `SourceRegistry.ts`.
- Falkenbergs kommun was not registered, approved, or touched in any way.
- The Ullared 2:215 PDF was not quarantined, hashed, or CAS-written.

## What would unblock this

`SourceRegistry.ts` would need real multi-key verification support — e.g. resolving the
verification key by `attestation.signer` against a small registered keyring (old key stays
trusted for its own historical entries; new key becomes the sole signer for anything newly
approved), rather than a single globally-configured key. That is itself a real, scoped code
change to a governance-critical module — not something to fold into a source-admission unit,
and not something this session should make unilaterally without the owner deciding the intended
rotation/keyring design (successor-only vs. multi-trusted-signer, revocation semantics, etc.).

## Status

```
SOURCE-REGISTRY-GOVERNOR-KEY-ROTATION-V1        STOPPED (model gap, not implementation gap)
new governor key                                NOT CREATED
existing MMOD registry entry                    UNCHANGED, still resolvable under its own key
                                                 (which remains unavailable locally for future
                                                 approvals, but does not need to be to keep
                                                 existing sources loadable)
MUNICIPAL-DECISION-SOURCE-ADMISSION-V1           still blocked, unchanged
```
