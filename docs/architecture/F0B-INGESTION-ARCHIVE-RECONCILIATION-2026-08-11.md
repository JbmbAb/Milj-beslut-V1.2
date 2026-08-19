# F0B — Reconciliation av masterarkiv/ingest mot befintliga kontrakt

Status: **DRAFT — read-only reconciliation. Ingen ny spec skapad, ingen kod skriven.**

Uppdrag: avgöra om den föreslagna arkivstrukturen (`raw/`, `manifests/`, `normalized/`,
`chunks/`, `attestations/`, `indexes/`, `rejected/`) ska (i) följa befintlig ADR, (ii)
supersede:a den, eller (iii) reconcilieras via konvergensspec. **Blockerar FAS 4.**

---

## Huvudfynd — konflikten var skenbar

F0A klassade steg 3 som `conflicting requirement` baserat på
`ADR-DOCUMENT-INGESTION-MANIFEST-CONTRACT.md`. Den bedömningen var **för snäv**: den ADR:n är
inte det styrande arkivkontraktet. Det finns en explicit supersessionskedja som inte var
synlig förrän arkivspåret följdes hela vägen:

```
mimers-brunn-offline-first.md   (v1.0)  → LEGACY
        ↓ superseded by
mimers-brunn-v2.0.1.md          (v2.0.1) → LEGACY   (Status-fältet säger LEGACY i filen)
        ↓ superseded by
mimers-brunn-v3.0.0.md          (v3.0.0) → ACTIVE   (2026-08-09, "National Environmental Knowledge Corpus")
```

**`mimers-brunn-v3.0.0.md` är den aktiva auktoriteten för insamling, arkivering och
tiering** — inte ingest-ADR:n, och inte v2.0.1 (vars §8-strukturdiagram jag först läste som
det gällande; det är formellt LEGACY).

### Den föreslagna strukturen är ingen konkurrerande modell — den är samma modell

v3.0.0 §3 definierar fem frysta skikt. Ställt mot ditt förslag:

| Ditt förslag | v3.0.0 Tier | Bedömning |
|---|---|---|
| `raw/` (originalbytes, orörda) | **Tier 2: Raw Archive** — "Originalbyte bevaras. SHA-256 + källa + datum + provenance." | Samma sak |
| `manifests/` | Tier 2/3 provenance + `_manifests` | Samma sak |
| `normalized/` | **Tier 3: Inventory** — "klassificeras, beskrivs och inventeras" | Samma sak |
| `chunks/` | **Tier 4/5** — Knowledge Corpus → domänindex | Samma sak |
| `indexes/` | **Tier 5: RAG / Domain Indexes** | Samma sak |
| `rejected/` / `quarantine/` | Tier 4 exkluderingsregister + lifecycle-state `QUARANTINED`/`REJECTED` | Samma sak, men v3.0.0 är **strängare** (se nedan) |
| `attestations/` | — | **Enda genuina tillägget.** v3.0.0 nämner inte attestations-lagring explicit. |

**Slutsats: ingen supersedering behövs.** Din struktur är en återupptäckt av v3.0.0:s
tier-modell uttryckt som katalogträd. Rekommenderad väg: **(i) följ befintligt kontrakt** — med
ett litet tillägg för `attestations/`.

### Varför den skenbara konflikten uppstod

v3.0.0 §7 säger uttryckligen: **"Filsystemssökvägar är inte identitet. Content identity för
harvested source data etableras genom SHA-256 integritetsverifiering."**

Katalogträdet är alltså inte kontraktet. Ditt förslag och ADR:ns "manifest som katalog-gate"
beskriver olika lager av samma sak — fysisk layout respektive identitet. De kan inte konflikta,
eftersom bara det ena är normativt.

---

## Korrigering av F0A:s lucka G1 — den finns inte

F0A pekade ut hämtningskontraktet (URL, HTTP-status, retry, MIME, rate limiting, förbud mot
AI-relevansfiltrering) som en genuin lucka att fylla i F0D. **Det var fel.** v3.0.0 täcker det
redan, och hårdare än förslaget:

- **§3.1 Tier 1 Source Registry, Fryst Invariant:** *"Source Registry är den enda auktoritativa
  auktorisationspunkten för extern harvesting. Om en agent hittar en ny intressant källa måste
  den föreslås till registret och godkännas innan harvesting sker. Ingen ostrukturerad
  webbcrawling är tillåten."* Här definieras `rate_limit`, `concurrency_limit`,
  `max_object_size`, `retry_policy` **per producent**.
- **§2 Fryst Invariant:** *"Hämta först. Bevara originalet. Klassificera senare. Filtrera endast
  genom explicit, versionerad och reversibel policy. Ingen källa får permanent förloras på grund
  av en agents relevansbedömning."*
- **§5 Agent Responsibilities:** *"INGEN av agenterna får på eget bevåg besluta: 'Det här verkar
  oviktigt, så jag hämtar inte'."* — Loke = Harvest/Provenance, Tor = Implementation.
- **§3.4 Tier 4:** varje exkludering måste registrera `source_id`, `inventory_id`,
  `policy_version`, `classification`, `decision`, `reason_code`, `decided_at`, `decided_by`,
  `raw_reference`.

Ditt krav "aldrig filtrera bort källa på AI-relevans" är alltså **redan en fryst invariant på
tre ställen**, och ditt planerade negativa test (`source cannot be AI-filtered away`) blir ett
test mot v3.0.0 §2/§5 — inte mot en ny regel.

**Enda kvarstående G1-rest:** v3.0.0 specificerar auktorisation och policy per producent, men
räknar inte upp exakt vilka *tekniska responsfält* som ska loggas per hämtning (HTTP-status,
MIME, storlek). Det är en detaljnivå under befintligt kontrakt, inte en normativ lucka —
lämplig att fastställa i F0D:s `SourceRegistryArtifact`-schema.

---

## Konsekvenser för planen

**KB-1 — FAS 4 är inte längre blockerad av ett vägval.** Vägen är (i): följ v3.0.0. Det som
återstår är ett litet tillägg för `attestations/`-lagring och att F0D:s registry-kontrakt
skrivs som Tier 1-materialisering.

**KB-2 — v3.0.0 gör task #19 ännu mer central.** Tier 1 Source Registry är *"den enda
auktoritativa auktorisationspunkten för extern harvesting"*. Det live-registret
(`server/modules/harvest/source-registry/registry.ts`, klassat `UNPROVEN /
RUNTIME_PROJECTION_UNVERIFIED`) är alltså inte bara overifierat — det ockuperar en roll som
v3.0.0 uttryckligen fryst som auktorisationspunkt. F0D ska skriva Tier 1-kontraktet, inte ett
nytt registry-koncept.

**KB-3 — lifecycle-modellen finns redan.** v3.0.0 §8: `REGISTERED` → `HARVESTED` → `VERIFIED` →
`CLASSIFIED` → `APPROVED` → `IMPORTED`, plus `REJECTED`/`QUARANTINED`. Detta ska återanvändas
rakt av; LU/MVP ska inte införa egna statusnamn (jfr det gamla `doc.status = 'INDEXED'`-
fristringsproblemet i TOR_INSTRUKTION:s PHASE 1-6-skiss).

**KB-4 — Tier 5 bekräftar `mps-legal-corpus`.** *"MÖD-dom → Legal Corpus → legal chunking →
legal retrieval"* är exakt den redan PROVEN-a importgrinden. Ingen omtag behövs — men notera
v3.0.0:s varning: *"Implementera inte RAG v3 förrän Source Registry + fullständig
arkivinventering + provenance är verifierade."* Det stöder den frysta fasordningen (F0D före
FAS 4) från ett oberoende håll.

---

## En governance-observation som bör åtgärdas

`mimers-brunn-v3.0.0.md` är **untracked i git** (`?? docs/architecture/mimers-brunn-v3.0.0.md`)
trots `Status: ACTIVE` och trots att den supersederar två dokument som båda är märkta LEGACY i
sina egna filer. Ett aktivt, superseder­ande styrdokument som inte är incheckat är en
governance-risk i sig: v2.0.1 är det som ligger i historiken, och det är LEGACY.

Detta är en observation, inte en åtgärd — jag har inte checkat in något.

---

## Rekommendation (kräver din frysning)

1. **Väg (i): följ `mimers-brunn-v3.0.0.md`.** Ingen supersedering, ingen konvergensspec, ingen
   ny arkivstruktur-spec.
2. Lägg till **ett** normativt tillägg: var signerade attestations lagras (`attestations/`
   respektive var i tier-modellen de hör hemma).
3. Låt F0D skriva `SourceRegistryArtifact` som **Tier 1-materialisering enligt v3.0.0**, inklusive
   `rate_limit`/`concurrency_limit`/`max_object_size`/`retry_policy` per producent samt de
   tekniska responsfälten (HTTP-status, MIME, storlek) som G1-resten.
4. Checka in `mimers-brunn-v3.0.0.md`.
