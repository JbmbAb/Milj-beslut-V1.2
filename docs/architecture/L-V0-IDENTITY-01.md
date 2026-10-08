# L-V0-IDENTITY-01 — owner decision

**Status: OWNER DECISION.** This note does not assign VERIFIED, PROVEN, COLD_VERIFIED or EXECUTION_VERIFIED.

It records the decision that accepts the BLOCKED unit. It does not change product code, `DownloadManifestIdentity.ts`, CAS, Librarian or PostGIS.

| | |
| --- | --- |
| Decision | L-V0-IDENTITY-01 |
| Accepts | `008894e7667916d5d82a18c2c61ec9e4f6d704dc` on `feature/loke-v0` |
| Evidence | [LOKE-V0-REPORT.md](./LOKE-V0-REPORT.md), [LOKE-V0-REUSE-INVENTORY.md](./LOKE-V0-REUSE-INVENTORY.md) |
| Base under that commit | `cf1e8f1f9b2c7fbe9c43d77ca638f48e684db301` |
| Next unit, not started | `L-V0-PREFETCH-VALIDATOR-CONTRACT` |

`008894e7` stays the BLOCKED design evidence. This file is a later commit. It does not amend that evidence.

## Decision

`DownloadManifest`-identiteten och dess SHA-domän ändras inte för att möjliggöra pre-fetch `SKIP`.

`SKIP` får endast utfärdas när en källa exponerar en verifierbar pre-fetch freshness/content-signal som är bunden till samma kanoniska source/target-identitet.

Exempel på godtagbara signaler, inte en färdig signallista:

- stark ETag med villkorad request
- upstream SHA/content digest
- stabil versions-/revision-ID med definierad semantik
- annan registry-bunden validator vars betydelse är dokumenterad och verifierbar

Frånvaro av sådan signal innebär ingen `SKIP`.

En lokal tidigare `DownloadManifest`, quarantine-hash eller deduplicering räcker inte ensamt som bevis för oförändrat remote-innehåll. En tidigare byte-hash säger vad som hämtades då. Utan ETag, Last-Modified, upstream-hash, versions-ID eller annan auktoritativ remote-identitet kan Loke inte veta vad endpointen skulle returnera nu. Att kalla två körningar samma före nätanropet vore ett antagande.

`partial` / `RESUME` förblir unsupported tills transportkontraktet faktiskt har resume-semantik.

Ingen Loke-specifik inventory state store införs.

Ingen ändring av CAS, Librarian eller PostGIS.

Redundant hämtning förblir fail-closed beteende tills en auktoritativ pre-fetch jämförelsesignal finns. Efter hämtning kan befintlig quarantine-dedup visa att bytes var identiska. Det är post-fetch dedup, inte inventory-first `SKIP`.

`DownloadManifest`-identiteten är en provenance-/execution-identitet, inte en cache key. Dess domän ändras inte för nätoptimering.

## What this does to the V0 table

`SKIP` / `RESUME` / `REHARVEST` / `DOWNLOAD` lovar mer än nuvarande kontrakt kan bevisa. Den tabellen är inte Loke V0:s genomförandeplan.

Senare, inte i denna commit:

- V0a skulle återanvända registry, executor och manifest, rapportera en tidigare lokal observation, och inte göra pre-fetch `SKIP` utan validator.
- V0b är conditional acquisition, först när transport eller source-adapter kan ge en verifierbar freshness-signal.
- `RESUME` är en separat framtida capability.

`regeringskansliet-sfs-1998-808` har ingen verifierbar pre-fetch validator i det befintliga kontraktet. En körning mot den källan hämtar igen. Den är inte vald som första källa för `SKIP`.

## Next unit

`L-V0-PREFETCH-VALIDATOR-CONTRACT` ska, när den startas, definiera exakt vilka upstream-signaler som får ge `SKIP`, utan att ändra `DownloadManifest`-identiteten. Först därefter väljs en första källa som faktiskt bär signalen.

Den enheten är inte påbörjad här. Ingen produktkod, inget test och ingen källvalsändring följer med detta beslut. Loke V0 förblir BLOCKED och är inte en blockerare för U51.
