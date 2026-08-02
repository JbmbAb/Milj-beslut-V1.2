# ADR-21-05: Runtime Result Separation

## Status
Accepted (Paket 21 Prerequisites)

## Context
Observability, logging, and telemetry are context-dependent and environmentally tied. If telemetry data is bundled directly into canonical runtime artifacts, the artifacts lose their determinism and identity because identical executions on different hardware or at different times will produce different telemetry.

## Decision
Telemetry is structurally isolated from canonical artifact data.

### Normative Rules

1. **Telemetry SHALL be structurally absent from every canonical artifact type.**
2. **Telemetry SHALL NOT affect identity.**
3. **Runtime SHALL return a `RuntimeResult` composite object:**
   ```typescript
   interface RuntimeResult {
       artifact: CanonicalArtifact;
       telemetry: TelemetryData;
   }
   ```
4. **Runtime SHALL NEVER mutate an artifact to inject telemetry (e.g., `artifact.telemetry = ...`).**

## Consequences
- Canonical artifacts remain perfectly replayable and deterministic.
- Observability and diagnostic data is safely captured and routed without poisoning the cryptographic backbone.
