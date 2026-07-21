# ADR-004: Verifierat verktygsspår före LLM (Vertex “dirigent” nivå 0)

**Datum:** 2026-04-25  
**Status:** Antagen  

## Kontext

Fri chatt (Gemini/Vertex) utan band kan hallucinera regler, risknivåer och krav. För B2B-miljöprodukt måste **samma input ge samma faktureringbara/auditbara utfall** där siffror och riskklasser kommer från **kod** — inte från språk.

## Beslut

1. `runComplianceWorkflowWithToolTrace` (i `services/orchestrationService.ts`) returnerar `toolTrace[]`: serialiserad input/output per steg `lab_validate` → `rule_engine_evaluate` → `logistics_analyze`.
2. `rule_engine_evaluate` output **är** `evaluateProjectCompliance` (reproducerbar TypeScript) — här är **bevisburen risk**.
3. `server/services/vertexDirigent.ts` får använda Vertex **endast** för att textuellt sammanfatta `toolTrace` när moln konfigurerat; utan moln byggs en **deterministisk** rapport så att CI fortfarande bevisar att spåret bär värde.

## Konsekvenser

- Nästa steg (function calling) kan mappa 1:1 mot samma `toolId`: deklaration i Vertex = brygga till samma handlare, inte nya trollformler.
- Rådtext från LLM ersätter aldrig `RuleEngineResult` i API-svar förrän juridiskt/affärsmässigt godkänt.

## Motivering (kort)

Detta är *bevis* mot “låt Gemini tänka fritt”: **vi kan visa att risknivån kommer från en hashbar kedja, inte från modell imagination.**
