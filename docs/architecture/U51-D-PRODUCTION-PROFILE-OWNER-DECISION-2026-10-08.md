# U51-D-PROFILE-1 -- production profile and entrypoint roots (owner decision record)

**Status: DECIDED.** This is a policy decision, not its implementation and not a proof. Nothing here is VERIFIED, PROVEN, U51_READY or FROZEN.

| Field | Value |
| --- | --- |
| decision_id | `U51-D-PROFILE-1` |
| owner | Jimmy Bruce |
| status | DECIDED |
| date | 2026-10-08 |
| scope | which processes are the production roots of the `on-prem-release-line` profile, which composition files are authoritative for it, and the invariant that ties a deployment change to the entrypoint composition. Unit `U51-RELEASE-V3-RECONCILIATION-01` ("D"). |
| contract | `2d937d6336d73ab11d428af7d56afc6fdb38d0ee`, `U51-CANONICAL-MANIFEST-CONTRACT-01` R2 section 5.3 (the entrypoint set is derived from the release composition, never hand-picked). Not modified by this record. |
| design it answers | `docs/architecture/U51-ENTRYPOINT-COMPOSITION-MODEL-DESIGN-2026-10-08.md` section 5, owner questions 1 to 4 (that design lives on the proof branch `rt/u51-generation-absence-proof-01`; this record does not copy it). |
| base this unit builds on | `b549c4be` (no-google combined closure) merged with the authoritative `rt/u42c` @ `ee35bb14a304b7b721df47b25cddccd36359fde5` |

## 1. Decision (verbatim)

The block below is the owner's decision as delivered, unchanged.

```yaml
OWNER_DECISION_D:
  production_profile: on-prem-release-line

  production_roots:
    - server/index.ts
    - server/workers/lu-project-context-bootstrap-worker.ts
    - server/workers/lu-execution-identity-v3-worker.ts
    - server/workers/lu-viewer-capability-worker.ts
    - server/workers/lu-geometry-supersession-worker.ts

  not_production_as_standalone_roots:
    - server/workers/run-all.ts
    - server/workers/municipality-polling-worker.ts
    - server/workers/gdpr-maintenance-worker.ts
    - server/workers/search-indexer-worker.ts
    - server/workers/domstol-rss-worker.ts

  web_static_closure:
    in_process_registry:
      - gdpr
      - search
      - municipality
      - domstol
    note: >
      Statiskt nåbara från server/index.ts och därför konservativt del av
      web-slutningen, men START_WORKERS_IN_PROCESS=false innebär inte att
      de är separata eller aktiva runtime-processer i LU-profilen.

  composition:
    docker-compose.prod.yml:
      authoritative_for_this_profile: false
      reason: W-U402-spärrad release-line-konfiguration

    deploy/onprem/docker-compose.lu.yml:
      merge_source: false
      authority_source: false
      status: corroborating_noncanonical_evidence_only

    docker-compose.yml:
      normative: false
    docker-compose.staging.yml:
      normative: false
    fly.toml:
      normative: false
    Dockerfile.fly:
      normative: false

  canonical_support_on_u42c:
    - deploy/onprem/image-smoke/smoke.mjs
    - Dockerfile
    - package.json

  invariant:
    deployment_change_requires_entrypoints_change: true
    frozen_RED_import_special_exception_allowed: false

GO D (owner, Jimmy Bruce, 2026-10-08) authorises:
  - the merge of b549c4be with the authoritative rt/u42c;
  - the semantic resolution of the known conflict in tests/unit/protectedRelationGateInventory.test.ts;
  - implementation of D with the decision above frozen;
  - creation of a machine-readable production composition / entrypoints.json;
  - a reachability proof from exactly the five production roots;
  - classification of the frozen RED file's import() ONLY by reachability proof, no wildcard, no special exception.
GO D does NOT authorise: merging rt/integration-u51; changing the reviewed SHAs of A (56f67431) or B (1a0c6457); reinterpreting production roots to make a proof green.
```

## 2. How the decision is implemented in this unit

- The five production roots are exactly `entries[]` of `deploy/onprem/entrypoints.json` (schema `u51-entrypoints-1`); the five non-roots are exactly
  `not_production[]`. The file is under `deploy/onprem/`, so it is covered by `composition_manifest_sha256` and a deployment change cannot be made
  without also touching it (the invariant above).
- The consistency rules, the derived hash and the reachability proof live in `packages/mps-release-entrypoints`.
- The in-process registry workers (gdpr, search, municipality, domstol) stay a property of `web`: their service code is statically reachable from
  `server/index.ts` and is therefore inside the web closure. The standalone worker files of the same names are not production roots.
- `deploy/onprem/docker-compose.lu.yml` exists only on the non-canonical `rt/integration-u51`. It is neither merged nor used as an authority here.
- The frozen RED file's `import()` gets no exception. It is classified only by the reachability proof (evidence outside the repository).

## 3. What this record does not say

- It does not say U51 is ready, frozen, proven or verified, and it does not say the five-root set is complete for any profile other than
  `on-prem-release-line`.
- It does not authorise merging `rt/integration-u51`, or treat it, `deploy/onprem/docker-compose.lu.yml`, `docker-compose.prod.yml`,
  `docker-compose.yml`, `docker-compose.staging.yml`, `fly.toml` or `Dockerfile.fly` as an authority for this profile.
- It does not change the contract, branches A (`rt/u51-core-01`) or B (`rt/u51-dynamic-import-closure-01`), or any other owner-decision record.
- It does not make the generation boot probe runnable; it supplies one input of it (the entrypoint composition).
- It does not decide the remediation of the four first-party non-literal dynamic imports (OD-17); those stay with their own unit.
