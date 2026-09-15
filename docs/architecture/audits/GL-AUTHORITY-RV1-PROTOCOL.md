# SCRIPT/PROTOCOL: GL-AUTHORITY-RV1

**TARGET:** Authority Semantics & Canonical Boundary Re-Verification  
**PURPOSE:** Låsa upp CONDITIONAL-status för `AUTHORITY-CONVERGENCE-01`  
**RULE:** Falsifieringsplikt gäller. Inga nya artefakttyper får föreslås om befintliga relationer kan bära semantiken losslessly.

## 1. PRE-AUDIT CONTEXT

Föregående granskning (`KERNEL-INTEGRATION-AUDIT-02`) konstaterade att auktoritetssemantik överlevde, men lämnade det öppet huruvida befintliga artefakter (`CapabilityGrant`, `TrustDelegation` etc.) fullt ut kan bära bevisbördan utan tillägg, samt vilken typmodell som de facto ska utgöra gränsen. Denna RV1 (Re-Verification) isolerar dessa specifika frågor.

## 2. UTVÄRDERINGSKRITERIER OCH TEST-SCRIPT

Granskaren MÅSTE utvärdera följande fyra domäner i `mps-core`, `mps-governance` och `mps-compliance` mot SHA-låst kod.

### Test 2.1: Capability & Trust Closure (Semantisk Bärighet)

**Fråga:** Kan de befintliga objekten `CapabilityGrantArtifact`, `CapabilityScopeArtifact` och `TrustDelegationArtifact` losslessly bära en fullständig auktoritetskedja?  
**Exekvering:**

1. Mappa artefakternas befintliga fält mot kraven: `actor identity`, `granted capability`, `scope`, `trust domain/root`, `delegation path`.
2. Sök efter stöd för: `activation`, `expiration`, `revocation`. **Godkännandekrav:** Om alla fält/funktioner antingen finns, eller kan härledas via befintliga state-maskiner, ska resultatet bli `LOSSLESS_REUSE`. Om (och endast om) t.ex. revocation är omöjligt att uttrycka, markera deltat.

### Test 2.2: Canonical Boundary Resolution

**Fråga:** Vilken referensmodell kan säkra "authority-critical paths" utan att tvinga fram en onödig repo-wide refaktorering?  
**Exekvering:**

1. Granska `mps-core` (`CanonicalArtifact` + `ArtifactReference`).
2. Granska `mps-compliance` (`ArtifactContract` + `ArtifactAttestation`).
3. Svara på: Kan `ArtifactContract` kombinerat med `ArtifactAttestation` ge samma kryptografiska `content_hash` och `signature`-garantier som `mps-core`-modellen vid beslutsögonblicket? **Godkännandekrav:** Identifiera exakt vilken kombination som utgör *Minimum Viable Boundary* för auktoritet. Besluta vilken interface-nivå motorn i `ACT_21_I1.ts` ska koda emot.

### Test 2.3: Evidence Representation (Inga Smugglade Typer)

**Fråga:** Krävs verkligen en ny `AuthorityEvidenceArtifact`, eller räcker en logisk samling referenser?  
**Exekvering:**

1. Utvärdera om ett beslut (t.ex. `LocalizationAssessmentArtifact`) kan uppfylla "evidence closure" enbart genom att lagra en array av `authority_refs` (pekandes på relevanta Grants/Delegations). **Godkännandekrav:** Om beslutsartefakten kan sluta kedjan med befintliga referenser = `NO_NEW_ARTIFACT_REQUIRED`.

### Test 2.4: Temporal Replayability (Tidsmodellen)

**Fråga:** Hur skiljer systemet på "authorized at decision time" och "authorized now"?  
**Exekvering:**

1. Analysera hur tidstämplar (t.ex. `mps-core.Timestamp`) appliceras på beslut och hur de relaterar till delegationernas/grantsens livscykel.
2. Kan en replay-funktion idag lita på att `T_decision` valideras mot delegationsstatus vid `T_decision`, även om aktuell tid är `T_now`? **Godkännandekrav:** Formulera det exakta logiska villkoret som replay-motorn måste använda för att förhindra att historiskt korrekta beslut markeras som ogiltiga efter att mandat löpt ut.

---

## 3. DEN OBLIGATORISKA LEVERABELN: RV1 VERDICT LEDGER

Granskaren får enbart returnera svaren i följande format. Inga fria tolkningar tillåts.

```text
GL-AUTHORITY-RV1 VERDICT LEDGER

1. CAPABILITY & TRUST CLOSURE
   Verdict: [LOSSLESS_REUSE | SEMANTIC_GAP]
   Missing semantics (if any): …
   Minimum delta required: …
2. CANONICAL BOUNDARY
   Verdict: [MPS_CORE_STRICT | MPS_COMPLIANCE_ATTESTED | HYBRID_INTERFACE]
   Target boundary definition: …
   Required interface for validators: …
3. AUTHORITY EVIDENCE REPRESENTATION
   Verdict: [EXISTING_REFS_SUFFICIENT | NEW_ARTIFACT_REQUIRED]
   Mechanism: …
4. TEMPORAL REPLAY MODEL
   Decision-time timestamp source: …
   Validation rule delta: …

FINAL DIRECTIVE UNLOCK:
[APPROVED FOR ACTIVE | BLOCKED PENDING CORE DELTA]
```

## 4. EXECUTION TRIGGER

När denna RV1 Verdict Ledger är ifylld, utgör den det sista tekniska underlaget. Om FINAL DIRECTIVE UNLOCK är APPROVED FOR ACTIVE, ändras status på AUTHORITY-CONVERGENCE-01 från CONDITIONAL till ACTIVE, och koden (minimum delta) får börja skrivas.

---

Med detta protokoll har ni stängt den sista metodologiska luckan. Agenten som utför denna granskning kan inte gissa, kan inte uppfinna, och kan inte "glida" semantiskt. Den måste titta på bytes och interfaces och besvara exakt hur bevisbördan ska bäras framåt.
