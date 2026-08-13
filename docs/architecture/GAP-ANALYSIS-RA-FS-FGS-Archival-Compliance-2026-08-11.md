# P7-ARCHIVE — Riksarkivet (RA-FS/FGS) Archival Compliance Gap Analysis

| Field | Value |
| --- | --- |
| **Status** | **Research only — no implementation.** Not a legal or archival certification. |
| **Date** | 2026-08-11 |
| **Method** | Web research against Riksarkivet's current published regulatory status (2026-08-11), cross-checked against a live read of Mimer's actual architecture (ADRs + source code, not just design docs) |
| **Companion document** | `ADR-MIMER-FUTURE-POTENTIAL-INVARIANTS.md` — this gap analysis is the "later" archival-export track that ADR flags but explicitly defers |

## 0. What this is and isn't

This is an architectural gap analysis, not a compliance sign-off. A real determination of "COMPLIANT" against Riksarkivet's requirements requires a qualified arkivarie (records/archives professional) and, for anything destined for permanent preservation or transfer to Riksarkivet, likely a formal dialogue with Riksarkivet itself. What this document does: verify Riksarkivet's *current* regulatory position (not assumed from training knowledge — checked via web search on 2026-08-11), and map it against what Mimer's architecture actually has today, per invariant, with evidence. No code changes are proposed or made.

## 1. Current regulatory status (verified 2026-08-11)

- **RA-FS 2009:2** (Riksarkivets föreskrifter och allmänna råd om tekniska krav för elektroniska handlingar) **remains formally in effect today**. Riksarkivet is mid-review (work ongoing 2025–2026) of its electronic-records regulations, and has publicly signaled a strategy shift: moving from fixed, named file-format requirements to **functional requirements** — rules about what a format must be capable of (long-term preservability, readability) rather than which specific format to use — backed by a dynamic, periodically updated list of acceptable formats rather than a static one in the regulation text. Until the new regulations are adopted, RA-FS 2009:2 governs. **Do not freeze Mimer's export/preservation format handling around RA-FS 2009:2's current specific format list** — build toward the functional-requirements direction Riksarkivet has already signaled, and re-check status before final implementation.
- **FGS (Förvaltningsgemensamma specifikationer)** — Riksarkivet's established, current specification families (confirmed via the official "Fastställda FGS:er" page) are: **FGS Paketstruktur** (package structure for SIP/AIP/DIP transfer — Riksarkivet has adopted the EU E-ARK CSIP/SIP specifications as FGS Paketstruktur v2.0), **FGS Arkivredovisning** (two variants: Allmänna arkivschemat and Verksamhetsbaserad arkivredovisning — how archive-structure/classification metadata is represented for transfer between systems), **FGS Databas** (based on SIARD, for relational database transfer/preservation independent of the source system), **FGS Ärendehantering** (case management), and **FGS Personal**.
- **Gallring (retention/destruction)** is governed by a separate RA-FS series distinct from the technical-format regulations (e.g. RA-FS 2021:6 on records of "uppenbart ringa betydelse," RA-FS 2021:3 on security records, and others scoped by document/authority type) — there is no single unified "gallring regulation," it's per-category, which matters for how a general-purpose retention mechanism should be designed (policy-driven, not hardcoded to one rule).

Sources checked: Riksarkivet's official "Fastställda FGS:er" page, Riksarkivet's "Pågående översyner" page (via a 2025-10-16 news summary — Tidskriften Arkiv), FGS Paketstruktur specification PDF, and the RA-FS regulation database (foreskrifter.riksarkivet.se). See §7.

## 2. Two-level preservation framing

Per the design discussion this document follows from: long-term preservation needs to be separated into two questions, because they have different failure modes.

```
1. PRESERVE THE OUTCOME        2. PRESERVE THE REPRODUCIBILITY
   artifacts, evidence,           canonical bytes, schemas,
   findings, decisions,           rule/model versions, algorithm
   metadata                       description, environment fingerprint
```

Mimer's architecture (CAS, content hashing, canonical artifacts, replay) is unusually strong on (2) — see the compliance matrix below. The open question is whether (1) is understandable **without** the Mimer runtime — i.e., whether an exported artifact means anything to a human or a different system 40 years from now, independent of whether `mps-runtime`, the current Node/Postgres/PostGIS stack, or the AI models used to produce findings still exist or run.

## 3. Compliance matrix

Status legend: **STRONG** (real, working mechanism, verified in code) · **PARTIAL** (real mechanism exists but incomplete, or exists at ADR/spec level without full implementation) · **GAP** (no mechanism yet) · **N/A** (not applicable to Mimer's current scope).

| # | Requirement area | Mimer invariant / mechanism | Status | Evidence |
|---|---|---|---|---|
| A | Elektroniska handlingars dokumentation (what an electronic record is, documented) | `CanonicalArtifact` (mps-core) + provenance chain | **PARTIAL** | `mps-core/src/types.ts`'s `CanonicalArtifact` (artifact_id, artifact_type, content_hash, signature) plus `ArtifactReference`/`ContentReference` give a documented identity shape. No `schema_version` field on the base type yet (see FUTURE-I05 in the companion ADR) — a record's own schema isn't self-describing at the type level, only via package-specific manifests. |
| B | System-/struktur-/relationsdokumentation | ADRs (this repo has ~50), `ADR-MPS-CONSTITUTIONAL-INVARIANTS.md`, `ADR-MIMER-FUTURE-POTENTIAL-INVARIANTS.md` | **STRONG** for internal documentation; **GAP** for a Riksarkivet-shaped "systemdokumentation" package | The architecture is unusually well-documented for engineers. Nothing yet packages this as the specific systemdokumentation/relationsdokumentation artifact Riksarkivet expects to accompany a transferred system's records. |
| C | Metadata och provenance | Content-addressed storage, `MimersBrunnManifest`, provenance chain (Authority → Provenance → Canonical identity → Evidence → ... → Proof) | **STRONG** | This is Mimer's strongest area by design — immutable artifacts, sha256 content hashes, `HashDescriptor`/`SignatureDescriptor` (algorithm-agnostic), replay determinism enforced by tests (`ConstitutionalPropertyTests.test.ts` etc.). |
| D | Bevarandeformat (preservation formats) | — | **GAP, and correctly so for now** | No format-freeze exists in Mimer today, which is the right posture given §1: Riksarkivet itself hasn't finalized whether RA-FS 2009:2's specific formats or functional requirements will govern. Building this now risks freezing around the wrong target. |
| E | Export utan Mimer-runtime | `ArtifactExporter`/`ProjectionExporter`, `MimersBrunnManifest` | **GAP leaning PARTIAL** | `ProjectionExporter.export()` is an unimplemented stub (`return {}`) per the architecture audit behind the companion ADR. `MimersBrunnManifest`'s versioned-media-type + `CASDescriptor` pattern *is* real, working, self-describing (content + hash + media-type-as-schema-version) — but scoped to pipeline/policy/runtime/metrics sealing, not general artifact export. This is the single highest-leverage gap: Riksarkivet's entire model (FGS, SIP/AIP/DIP, e-arkiv) assumes information can be understood independent of the producing system. |
| F | FGS Paketstruktur / SIP | — | **GAP** | No SIP/AIP/DIP packaging exists. Would sit downstream of E: `Mimer CAS/artifacts → Archive Export → SIP (FGS Paketstruktur / E-ARK CSIP-SIP v2.0) → e-arkiv`. |
| G | FGS Ärendehantering (where relevant) | `mps-decision-governance`'s decision/case artifacts | **PARTIAL, needs scoping** | Whether Mimer's decision-support workflow constitutes "ärendehantering" in Riksarkivet's sense (vs. the municipality/authority's own case-management system being the ärendehantering system of record, with Mimer as an evidence/analysis tool feeding it) is an open scoping question, not an implementation gap — needs an archivist's read before any FGS Ärendehantering mapping is attempted. |
| H | FGS Arkivredovisning | — | **GAP** | Mimer's provenance graph is not the same thing as a formal arkivredovisning (archive structure/classification scheme). No mapping exists from Mimer's artifact taxonomy to either Allmänna arkivschemat or Verksamhetsbaserad arkivredovisning. |
| I | SIARD/databasexport (where relevant) | PostgreSQL/PostGIS as the retrieval/materialization layer (CAS remains authority) | **GAP, scoping question** | Since CAS is authority in Mimer's own architecture (not Postgres), FGS Databas/SIARD would apply, if at all, to the PostgreSQL/PostGIS materialization layer specifically — worth a dedicated look, but it's secondary to CAS export (E/F) since Postgres is explicitly a rebuildable projection, not the source of truth (`ADR-MPS-SINGLE-MATERIALIZATION-AUTHORITY.md`, `ADR-MPS-CAS-STORAGE-BOUNDARY.md`). |
| J | Gallring (retention/destruction) | `ADR-24-24-Data-Retention-Tombstone.md` + real implementation: `packages/mps-governance/src/retention/{TombstoneArtifact,RetentionDecisionArtifact}.ts`, validators `packages/mps-compliance/src/validators/RET_24_I{3,5}.ts` | **STRONG mechanism, GAP on legal mapping** | This is a genuinely well-designed, implemented model: `RECOVERABLE / NON_RECOVERABLE / DESTROYED / UNKNOWN` states, every retention action bound to exactly one governed `RetentionDecisionArtifact` with an authority reference, destruction doesn't invalidate provenance/audit (RET-24-I7). What's missing: no evidence this is wired to actual Riksarkivet gallring categories (BEVARAS / GALLRAS / GALLRAS EFTER X / ÖVERLÄMNAS) or to any real municipality/authority gallringsbeslut — the mechanism exists, the legal policy content doesn't yet. Given gallring is governed per-category (RA-FS 2021:6, 2021:3, etc.) rather than by one blanket rule, `RetentionPolicyArtifact` being policy-driven rather than hardcoded is the right shape for this. |
| K | Överlämnande till e-arkiv | — | **GAP** | Depends entirely on E/F being built first. |
| L | Verifiering efter export/import | Replay/manifest verification (`ChunkVerifier.verifyManifestsEqual`, `ConstitutionalPropertyTests`) as an internal pattern | **PARTIAL** | The verification *pattern* (hash/manifest comparison, fail-closed rejection) is proven internally for Mimer-to-Mimer replay. It has not been exercised for a round-trip through an actual SIP/e-arkiv package, which is a different verification surface (did the archive system preserve what was sent, not just did Mimer replay itself correctly). |

## 4. Overall assessment

Mimer's architecture is genuinely unusually well-aligned with Riksarkivet's underlying principles — integrity, documentation, traceability, and long-term intelligibility of information are load-bearing design goals here, not afterthoughts (see immutable artifacts, content hashing, provenance, replay, governance/authority separation, and the retention/tombstone model in the matrix above). That is not the same as having proof that Riksarkivet's *specific* requirements are met. The concrete gaps cluster almost entirely around **archival export and packaging** (E, F, H, K) — turning CAS-native artifacts into something an e-arkiv system and a future archivist, with no access to Mimer's runtime, can independently understand — plus two **scoping questions** that need an archivist's judgment rather than more engineering (G, I).

## 5. Suggested next step (not authorized by this document)

A formal RA-FS/FGS gap analysis with an actual qualified archivist, scoped specifically to E/F/H/K (export, SIP packaging, arkivredovisning mapping, e-arkiv handoff), would likely be the highest-value next step — before format or export-boundary decisions get made implicitly by unrelated feature work. This document does not authorize starting that implementation; per the companion ADR, archival export remains an explicit non-goal for now (§10 there), tracked here as a known, scoped-but-deferred gap.

## 6. Relationship to the Mimer Future-Potential Invariants ADR

This gap analysis doesn't add new invariants to that ADR. If anything here becomes active work, `FUTURE-I07` (export/runtime independence) is the invariant it would extend — implementing `ProjectionExporter` for real, generalized from `MimersBrunnManifest`'s already-working self-describing pattern, is the shared prerequisite for E, F, H, and K above.

## 7. Sources

- [Fastställda FGS:er](https://riksarkivet.se/arkivera-och-forvalta/medium-och-format/forvaltningsgemensamma-specifikationer/faststallda-fgser) — Riksarkivet, current FGS families (Paketstruktur, Arkivredovisning, Databas/SIARD, Ärendehantering, Personal)
- [Specifikation FGS Paketstruktur](https://riksarkivet.se/files/2024/12/fgs_paketstruktur_specifikation_rafgs1v1_1.pdf) — Riksarkivet, SIP/AIP/DIP structure, E-ARK CSIP/SIP v2.0 adoption
- [FGS Arkivredovisning](https://riksarkivet.se/resurser/fgs-arkivredovisning) — Riksarkivet
- [FGS Databas (Baserad på SIARD)](https://riksarkivet.se/files/2024/12/fgs_databas_baserad_paa_siard_rafgs6_v1_020210628_webb.pdf) — Riksarkivet
- [Riksarkivet släpper fasta formatkrav för e-handlingar](https://www.temaarkiv.se/riksarkivet-slapper-fasta-formatkrav-for-e-handlingar) — Tidskriften Arkiv, 2025-10-16, on the shift to functional format requirements and RA-FS 2009:2's current status
- [RA-FS 2009:2](https://lagen.nu/ra-fs/2009:2) — lagen.nu, regulation text reference
- [Sök i Riksarkivets föreskrifter](https://foreskrifter.riksarkivet.se/) — Riksarkivet's regulation database (RA-FS series, including gallring regulations RA-FS 2021:6, RA-FS 2021:3)
- [Vägledning om värdering och gallring](https://riksarkivet.se/arkivera-och-forvalta/informationsvardering-och-gallring) — Riksarkivet
