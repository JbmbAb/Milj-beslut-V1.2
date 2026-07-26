# Geo-Regulatory Engine Preparation

## Purpose

This preparation creates a safe separation between:

- the shared platform core
- future domain packs such as sewage, shoreline protection, building permit and stormwater

The goal is to reduce future rewrite pressure without forcing a large refactor now.

## What Was Added

New additive files:

- [types.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/geo-regulatory/types.ts)
- [catalog.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/geo-regulatory/catalog.ts)
- [registry.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/geo-regulatory/registry.ts)
- [index.ts](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix\_-copy-of-Miljobeslut.se-portal/server/geo-regulatory/index.ts)

These files do not change existing runtime flows. They provide a future-safe vocabulary for:

- domains
- rule packs
- evidence bundles
- submission envelopes
- feedback signals
- human review gates

## Core Vs Domain

The platform should evolve in two layers.

### Core engine

Shared capabilities that should remain domain-agnostic:

- PostGIS binding
- legal source ingest
- requirement matrix projection
- document generation
- submission dispatch
- feedback ingestion
- audit chain
- economic snapshots

### Domain packs

Rule packs that sit on top of the core:

- `sewage`
- `shoreline_protection`
- `building_permit`
- `stormwater_lod`
- `mass_handling`

The scaffold in `server/geo-regulatory` makes this explicit without forcing existing sewage or permit services to move yet.

## Why This Is Safe

The preparation is intentionally low-conflict:

- no existing service contracts were changed
- no Prisma schema was touched
- no existing routes were rewritten
- no new runtime dependency was introduced
- all changes are additive and isolated

This means current work on ingest, submissions, UI and audits can continue without merge pressure from a structural rewrite.

## How To Use It Later

Future implementation can migrate into the engine gradually.

Suggested order:

1. Keep current production flows as-is.
2. When a service needs new cross-domain behavior, model it first using the shared `GeoRegulatory*` types.
3. Move only the shared logic into reusable core services.
4. Keep domain-specific legal logic inside dedicated rule packs.

## Suggested Next Safe Steps

### Step 1

Add a persisted submission spine in Prisma for:

- `Submission`
- `SubmissionArtifact`
- `SubmissionStatusEvent`
- `AuthorityInboxEvent`

This is the highest-value structural change because it turns dispatch and feedback into durable traceability objects.

### Step 2

Add a shared inbound feedback interpreter that maps:

- API callbacks
- email ingestion
- municipal polling
- manual registrations

into a common `GeoRegulatoryFeedbackSignal`.

### Step 3

Introduce the first new rule pack with strict scope:

- `shoreline_protection` or `stormwater_lod`

This keeps expansion bounded while proving the architecture.

## Explicit Non-Goals Right Now

This preparation does not yet:

- run any new decision logic
- change current sewage processing
- persist new submission entities
- alter PostGIS import behavior
- enable automatic legal conclusions without review

That is intentional. The point of this step is to prepare the architecture now without creating new conflicts.
