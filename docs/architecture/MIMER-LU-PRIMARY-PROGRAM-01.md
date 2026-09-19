# MIMER-LU-PRIMARY-PROGRAM-01
**PROGRAM:** MIMER SOVEREIGN AUTONOMY PROGRAM (Fas 1)  
**PRIMARY PRODUCT:** Lokaliseringsutredning (LU)  
**STATUS:** ACTIVE (PILOT_READINESS)

## PURPOSE
Lokaliseringsutredningen (LU) är det primära, vertikala beviset för att Mimer fungerar som en reproducerbar, styrd och i ökande grad autonom beslutsplattform för miljöprövningar. All plattformsutveckling mäts mot dess förmåga att exekvera LU autonomt, säkert och spårbart.

## PRIORITY ORDER
* **P0:** Lokaliseringsutredning (LU) - Canonical Path & Proof
* **P1:** Plattformsförmågor (Foundation/Autonomy) som strikt krävs för att göra LU mogen
* **P2:** C-anmälan (Korpusbevarande och produktåteranvändning)
* **P3:** MimerLM (Lokal kognition)

## THE INTERRUPTION RULE
En generell plattformsuppgift eller arkitekturhypotes får avbryta LU-fokus **ENBART** om den uppfyller minst ett av följande kriterier:
1. Den blockerar LU-korrekthet (Correctness).
2. Den blockerar en ren och reproducerbar miljö (Reproducibility).
3. Den blockerar oberoende verifiering av beslut (Audit).
4. Den avlägsnar ett återkommande manuellt operatörssteg från LU-kedjan.
5. Den skapar nödvändig evaluerings-evidens (Mimer-Eval).

---

## NOW / NEXT / LATER

**NOW (Active Sprint)**
1. Etablera LU Canonical Path (Eliminera dubbla exekveringsvägar).
2. Stabilisera Proof Infrastructure (Spårbarhet från indata till beslut).
3. Åtgärda defekter i migration/reproducerbarhet som blockerar Clean LU Install (ex. Storage Pressure).
4. Reducera `LU_MANUAL_INTERVENTION_COUNT`.

**NEXT**
5. Expandera LU-bredden (Fler fastigheter, lager, dokumenttyper).
6. Expandera LU Eval (MIMER-EVAL v1).
7. Garantera Cold Clean-Machine Reproduction.
8. Beredskap för extern kodgranskning (External Code Review Readiness).

**LATER**
9. Exploatering av C-anmälan korpus.
10. Bredare autonoma operationer (Generell GAO).
11. MimerLM-experiment (50M - 250M).

**PARKED (Inväntar bevisbörda via KERNEL-INTEGRATION-AUDIT)**
* Mission (som isolerat kärnobjekt)
* Nya Authority/Decision/Outcome-typer
* Generell GAO-ontologi
* *Regel: Ingen avparkering utan bevisat "Core Delta".*

---

## LU CANONICAL INTEGRATION CHAIN
Varje steg i LU exekveras genom följande arkitektoniska sekvens. Varje nod ska på sikt hanteras autonomt.

USER / PROPERTY INQUIRY  
↓  
CANONICAL PROPERTY IDENTITY (Fastighetsuppslag)  
↓  
PROJECT CONTEXT (Initiering av arbetsyta/worktree)  
↓  
SPATIAL DATA (PostGIS/Geodata-inhämtning)  
↓  
DOCUMENT KNOWLEDGE (RAG/Retrieval)  
↓  
EVIDENCE (Konsolidering av oberoende fakta)  
↓  
AUTHORITY / ADMISSION (Mandatkontroll och regelapplicering)  
↓  
RULES / COGNITION (Faktabedömning mot lagkrav)  
↓  
LOCALIZATION ASSESSMENT (Kärnbeslutet)  
↓  
PRESENTATION (PDF / Cesium 3D)  
↓  
AUDIT / REPLAY / VERIFY (Beviskedjestängning)  
↓  
OUTCOME / OPERATOR FEEDBACK (Lärande loop)

---

## SYSTEM LEDGERS (Append-Only Sanningskällor)
Detta dokument stöds operativt av följande register. Ingen separat Roadmap får skapas.
* **`docs/architecture/lu/LU-PILOT-READINESS-LEDGER-01.md`**: Blockerare för LU-leverans.
* **`docs/architecture/platform/FOUNDATION-DEBT-LEDGER-01.md`**: Skuld, städning och deduplicering (t.ex. lagringsincidenter).
* **`docs/architecture/platform/AUTONOMY-LEDGER-01.md`**: Spårning av manuella steg och `LU_MANUAL_INTERVENTION_COUNT`.
* **`docs/architecture/platform/AUDIT-PROOF-LEDGER-01.md`**: Register över vilka claims som är bevisade (PROVEN/NOT_PROVEN/STALE).
* **`docs/architecture/platform/NEGATIVE-KNOWLEDGE-LEDGER-01.md`**: Vad vi bevisat att vi *inte* ska bygga.
