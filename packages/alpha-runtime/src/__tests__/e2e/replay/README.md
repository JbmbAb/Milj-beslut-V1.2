📘 Replay Test Suite — Phase 3.2.4
Deterministic Checkpoints & Replay Verification
Den här katalogen innehåller den fullständiga end‑to‑end‑testsviten för Phase 3.2.4: Checkpoints & Replay.
Testerna verifierar att runtime‑motorn är deterministisk, audit‑bar, content‑addressed och reproducerbar över processgränser.

1. 🔧 Replay‑arkitektur (Phase 3.2.4)
Replay‑motorn bygger på tre centrala komponenter:

1. CheckpointArtifact
En content‑addressed snapshot av en körning:
- execution_identity_hash
- execution_plan_hash
- dependency_graph_hash
- deterministic_seed
- completed_steps
- produced_outputs (canonical registry references)
- replay_fingerprint

Checkpointen är WORM‑kompatibel och kan serialiseras, signeras och arkiveras.

2. ReplayFingerprintArtifact
Ett “witness”‑objekt som representerar den kanoniska formen av en körning:
- canonical payload
- sorted output references
- schema_version
- SHA‑256 fingerprint

Fingerprinten används för:
- snabb jämförelse
- audit‑loggning
- signering
- cache‑optimering

Fingerprinten är inte den normativa sanningskällan för replay‑validitet.

3. ReplayVerifier
En invariant‑driven verifieringsmotor som:
- kör en uppsättning ReplayInvariant‑objekt
- returnerar full diagnostik
- separerar fingerprint_valid från replay_valid
- fungerar som en ren orkestrator

ReplayVerifier.strict() är governance‑profilen.

2. 🧩 Replay‑kontraktet (Strict Profile)
ReplayVerifier.strict() verifierar följande invariants:

Invariant | Syfte
--- | ---
Execution identity hash | Verifierar initiala envelope‑parametrar
Execution plan hash | Verifierar DAG‑generering
Dependency graph hash | Verifierar topologisk sortering
Deterministic seed | Verifierar deterministisk exekvering
Completed steps | Verifierar scheduler‑ordning
Output artifacts | Verifierar content‑addressed outputs
Replay fingerprint | Witness för hela körningen

ReplayVerifier.strict() är ett governance‑kontrakt. Alla invariants måste finnas — annars är profilen ogiltig.

3. 🔍 Fingerprint vs Invariants
Det här är en central designprincip:

Replay fingerprint:
- witness
- cache
- signering
- audit‑loggning
- snabb jämförelse
Fingerprinten är optimering, inte normativ verifiering.

Replay invariants:
- normativ verifiering
- diagnostik
- exakt felrapportering
- replay_valid baseras endast på invariants

Fingerprint_valid och replay_valid kan divergera — och det är avsiktligt.

4. 🧪 Teststrategi
Testsviten består av två nivåer:

1. Unit‑tester
Verifierar varje invariant isolerat.

2. E2E‑tester
Verifierar hela replay‑kedjan:
- runtime
- checkpoint
- canonicalisering
- fingerprint
- replay
- verifiering

E2E‑testerna är designade för att täcka alla invariants utan duplicering.

5. 🧱 ReplayTamper Fixture
ReplayTamper.ts är en deklarativ, immutabel fixtur som används av alla negativa tester.

Syften:
- undvika mutation av readonly‑objekt
- undvika duplicerad manipulationskod
- säkerställa att endast avsedd invariant påverkas
- göra tester självbeskrivande

6. 🧪 E2E‑testmatta
1. Deterministic replay succeeds: Bevisar att replay fungerar i baslinjefallet.
2. Output hash tampering: Bevisar content‑addressing och fingerprint.
3. Deterministic seed mismatch: Bevisar deterministisk exekvering.
4. Plan / dependency graph mismatch: Bevisar DAG‑integritet.
5. Execution order mismatch: Bevisar scheduler‑ordning.
6. Profile mismatch: Bevisar governance‑kontraktet.
7. Multiple mismatches: Bevisar att replay‑motorn rapporterar exakt rätt invariants vid kombinerade fel.
8. Persisted replay: Bevisar reproducerbarhet över processgränser (checkpoint serialiseras, deserialiseras, replay körs i ny runtime, strict verifiering passerar). Det här är det starkaste audit‑beviset.

7. ➕ Adding a new invariant
När en ny invariant läggs till:
1. Implementera ReplayInvariant (med id, display_name, description, severity, verify())
2. Lägg till den i ReplayVerifierProfiles.strict()
3. Skapa två tester: success, failure
4. Uppdatera fingerprint‑payload om invarianten påverkar canonicalisering
5. Lägg till ett negativt E2E‑test om invarianten är kritisk
