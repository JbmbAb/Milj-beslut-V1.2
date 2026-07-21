# Submission Spine

## Purpose

The submission spine is the persistent layer that turns outbound dispatch and inbound authority feedback into durable case objects.

It exists so the platform can answer:

- what was sent
- when it was sent
- to whom it was sent
- which documents were included
- what status changes came back
- which inbound decision or injunction belongs to which case

## Added Prisma Models

The schema now includes:

- `Submission`
- `SubmissionArtifact`
- `SubmissionStatusEvent`
- `AuthorityInboxEvent`

These models live in [schema.prisma](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix*-copy-of-Miljobeslut.se-portal/prisma/schema.prisma), with SQL migration in [migration.sql](/Users/jimmy/Desktop/utvecklings arbete/Kod/Ny mapp/remix*-copy-of-Miljobeslut.se-portal/prisma/migrations/20260403003000_add_submission_spine_models/migration.sql).

## Intent Of Each Model

### Submission

One outbound process to a municipality or authority.

Stores:

- case and project linkage
- recipient authority
- dispatch channel
- external reference
- case number
- lifecycle status
- payload snapshot

### SubmissionArtifact

The concrete files or payload pieces attached to the submission.

Stores:

- primary document
- attachments
- receipts
- inbound decisions
- complement requests

### SubmissionStatusEvent

The timeline of what happened to a submission.

Examples:

- prepared
- dispatched
- delivered
- received
- pending review
- failed

### AuthorityInboxEvent

One inbound signal from municipality or authority.

Examples:

- acknowledgement
- status update
- decision
- injunction
- complement request

It is intentionally review-aware so that inbound legal effects can be held behind human review.

## Why This Is Low-Conflict

This preparation is additive:

- no existing route was changed
- no current service was re-pointed
- no document flow was replaced
- no authority adapter was rewritten

The new tables simply give the repo a durable target for future integration.

## Recommended Adoption Order

1. Persist new outbound permit submissions into `Submission` and `SubmissionArtifact`.
2. Write `SubmissionStatusEvent` from current authority and municipality services.
3. Route status polling and callback handling into `AuthorityInboxEvent`.
4. Only after that, let inbound events create review work and update `RequirementCase`.

## Human-In-The-Loop Boundary

The important rule remains:

- an inbound event may be auto-classified
- but it must not change legally binding case state without human approval

That boundary should be implemented through:

- `AuthorityInboxEvent.reviewStatus`
- explicit review UI
- audited promotion into `RequirementRecord`, `RequirementMatrixRow` or case state
