# OD-12-A — Lantmäteriet factual terms and compliance mapping

Status: EXTERNAL remains unchanged
Writer: ChatGPT
Cold verifier: Claude
Captured: 2026-09-27
Base: protected main `b6511b972ca48fb37c4ec996e43194246e58a1c3`
Scope: read-only factual mapping for later Source Registry and external review.

## 1. Method and outcome vocabulary

This record does not make a legal ruling. It maps current official Lantmäteriet texts to Mimer's observed code/data flows.
Every external source used here is stored under `docs/architecture/od12a-lm-compliance/snapshots/` and bound by URL, capture date and SHA-256 in `SNAPSHOT-MANIFEST.md`.

Allowed outcome labels:
- **förenligt enligt villkorstext**
- **tolkningsfråga**
- **restriktion**

The map status for OD-12 remains **EXTERNAL**. This record does not alter ADR-28A §7 or D-P5-6/J-9.

## 2. Current official terms observed

The current general terms page states that conditions depend on product and whether personal data is included.
The current valuable-dataset terms without personal data state CC BY 4.0 and require attribution when data is published or otherwise distributed.
The current valuable-dataset terms for products containing personal data also state CC BY 4.0, and additionally bind use to the purpose in the application/decision, necessity of selected personal data, and storage rules.
Lantmäteriet's current product-support page states that Fastighetsregister data with personal data is subject to purpose assessment under FRL.
## 3. Product inventory actually observed in Mimer

Owner-supplied account fact for K-16a: current Lantmäteriet applications/subscriptions are held under Jimmy's sole proprietorship. Exact registered licensee name, application dates and submitted purpose texts have not yet been captured into this evidence bundle. They are therefore recorded as `ej inhämtat`, not inferred.

| Product/channel | Observed Mimer use | Runtime role | Official product signal | Licenstagare / juridisk person | Ansökningsdatum | Inlämnad ändamålstext | Prövningsstatus | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fastighetsindelning Nedladdning, vektor / STAC | National GeoPackage harvest, merge and import to `env.registerenhetsomradesytor`, then materialization to `core.property_unit` | Source/import channel | Product page: no fee, legal purpose assessment, special terms; current terms class used by product is valuable datasets containing personal data | Jimmys enskilda firma; exakt registrerat namn/org.nr ej inhämtat | ej inhämtat | ej inhämtat | ej inhämtat | tolkningsfråga |
| Fastighetsindelning Direkt / OGC API Features | Harvest/lookup code exists; current integration registry says UI uses local PostGIS and live LM is rejected for UI | Source/verification channel, not LU UI authority | Product page: no fee, legal purpose assessment, special terms; OAPIF endpoint | Jimmys enskilda firma; exakt registrerat namn/org.nr ej inhämtat | ej inhämtat | ej inhämtat | ej inhämtat | tolkningsfråga |
| Belägenhetsadress | STAC/import registry entry exists as a separate LM dataset | Tier-2 source channel; not frozen LU-v1 mandatory layer | Product documentation says legal purpose assessment and special terms | Jimmys enskilda firma; exakt registrerat namn/org.nr ej inhämtat | ej inhämtat | ej inhämtat | ej inhämtat | tolkningsfråga |
| Fastighet och samfällighet Direkt | Alternative/legacy lookup path referenced by service code; not the current local PostGIS LU path | Non-authoritative alternative path | Product documentation says fee, legal purpose assessment and licence terms | Jimmys enskilda firma; exakt registrerat namn/org.nr ej inhämtat | ej inhämtat | ej inhämtat | ej inhämtat | tolkningsfråga |
| FAPI v1 | Code explicitly states the tenant FAPI surface is for registration actions, not property designation GET lookup | Not a property-data source for current LU lookup | No OD-12 data-use conclusion drawn from subscription name alone | Jimmys enskilda firma; exakt registrerat namn/org.nr ej inhämtat | ej inhämtat | ej inhämtat | ej inhämtat | tolkningsfråga |
| Hydrografi Nedladdning | Intended hydrografi source for later water/hydrology work; hydrografi/ytvatten remains a declared LU-v1 gap and is not required for W1-W3 | Future source/import channel; not current LU-v1 runtime | Current LM terms snapshot is product-specific; current fee document states 0 kr and särskild prövning is required | Jimmys enskilda firma; exact registered name/org.nr ej inhämtat | ej inhämtat | ej inhämtat | ändamålsprövning pågår hos Lantmäteriets jurister | tolkningsfråga |

The API-portal subscription name alone is not treated as evidence of permitted product use. Product documentation, terms and the actual LM account decision/purpose text are the relevant evidence sources.

### 3.1 Licensee transition and admission identity

K-16a requires the current applications/subscriptions to be replaced with applications in Mimer's name before external exposure. This record does not perform that change. For Source Registry/admission, the licensee identity under which source bytes were obtained must remain attached to those bytes.

A change from the current sole-proprietorship account to Mimer is handled forward-only: new application per affected product, new purpose/decision evidence, and a new admission record for data obtained under the new licensee. Historical admission identity is not rewritten.

Hydrografi Nedladdning remains **EXTERNAL** while its purpose assessment is pending. That pending assessment does not alter the frozen LU-v1 layer list: hydrografi/surface water remains explicitly not analysed where source basis is unavailable.

## 4. Fastighetsindelning — field-level mapping

Mimer's canonical import registry expects these source attributes for register-unit area polygons:
`objektidentitet`, `registerenhetsreferens`, `etikett`, `kommunnamn`, `trakt`, plus geometry.

`core.property_unit` stores: source key, designation, normalized designation, municipality/county metadata, source dataset/update metadata, `raw_properties`, and MultiPolygon geometry.
### 4.1 Field classification

| Field / data element | Direct natural-person identifier observed? | Property/location linkage | Mimer use | Outcome |
| --- | --- | --- | --- | --- |
| `objektidentitet` | No name/personnummer observed | Identifies source object | provenance/deduplication | förenligt enligt villkorstext |
| `registerenhetsreferens` | No direct person field observed | Direct register-unit linkage | source identity / joining | tolkningsfråga |
| `etikett` / designation | No direct person field observed | Property designation | property lookup and LU context | tolkningsfråga |
| `kommunnamn` | No | Administrative geography | filtering/context | förenligt enligt villkorstext |
| `trakt` | No direct person field observed | Location/property designation component | lookup/context | förenligt enligt villkorstext |
| geometry | No direct person field observed | Exact property-area linkage | spatial evidence and property boundary | tolkningsfråga |
| `raw_properties` | Depends on complete source-row schema | May retain attributes beyond the explicit five-field contract | provenance/debug/source reconstruction | restriktion |

The distinction above is technical, not a legal reclassification of the LM product. Lantmäteriet currently places Fastighetsindelning under the terms for valuable datasets containing personal data even though the explicit Mimer LU field set contains no owner name or personnummer.

### 4.2 Raw-property retention finding

`scripts/db/sync-property-unit-from-env.ts` constructs `raw_properties` from the complete source row excluding geometry.
The current LM personal-data terms require selection to be limited to data necessary for the purpose described in the application/decision.
Therefore a full-row JSON retention strategy may not be assumed to be acceptable merely because the normalized LU columns are narrow.

Required closure evidence:
1. enumerate the exact current source-row keys reaching `raw_properties`;
2. map each retained key to a documented Mimer purpose;
3. remove or separately justify keys without a demonstrated purpose.

Until that is done, this point is **restriktion**.
## 5. Mimer use-flow mapping

Observed target architecture for the LU property path:

`Lantmäteriet source → harvest/import → governed archive/CAS evidence → PostGIS env layer → core.property_unit → LU property/spatial evidence`.

The integration registry states that the browser/UI does not call Lantmäteriet directly for the property lookup path and that PostGIS is the UI source. This reduces external API exposure but does not remove conditions attached to received/stored data.

| Terms point | Observed Mimer behavior | Outcome |
| --- | --- | --- |
| Product data may be used/modified under CC BY 4.0 subject to applicable product terms | Mimer transforms source data into local PostGIS and derived LU evidence | förenligt enligt villkorstext |
| Attribution when publishing/distributing | No canonical product-surface attribution proof is bound in this unit | restriktion |
| Purpose must match the purpose represented in the LM application/decision for personal-data products | Exact application/decision text is not yet snapshotted into this evidence bundle | tolkningsfråga |
| Selection should be limited to necessary personal data | Normalized LU fields are narrow, but `raw_properties` retains the source row minus geometry | restriktion |
| Storage/location requirements in personal-data terms | Platform target is on-prem/offline-first; exact deployment/storage proof is outside this docs unit | tolkningsfråga |
| LM may change terms | Snapshot bundle stores date, URL and SHA-256 | förenligt enligt villkorstext |
| Property boundaries are not legally binding boundaries | Mimer uses them as spatial/decision-support evidence, not as formal cadastral boundary authority | förenligt enligt villkorstext |

## 6. Source Registry implications

The current import registry labels Fastighetsindelning entries as `license: 'CC0'`.
The current official Fastighetsindelning product material points to the valuable-dataset terms containing personal data, whose licence clause states CC BY 4.0.
This is a factual registry mismatch and is **restriktion** until corrected in a separately governed source-admission/registry unit.

The same registry should not infer licence from endpoint family or historic open-data assumptions. Licence identity should bind at minimum:
- product name and version,
- terms snapshot SHA-256,
- source URL,
- LM purpose/decision reference when applicable,
- capture/effective date,
- attribution requirements.
## 7. Items for narrowly scoped external review

External review need not rediscover the technical architecture. The remaining questions can be presented as a bounded list:

1. Does the exact purpose stated in Mimer's Lantmäteriet account/application/decision cover the observed LU processing described in §5?
2. Which Fastighetsindelning fields, if any, are treated as personal data in Mimer's specific processing context despite containing no owner name/personnummer?
3. Is retaining the complete non-geometry source row in `raw_properties` necessary under that purpose, or should retention be narrowed?
4. What attribution must appear in generated LU/PDF/map outputs when LM-derived geometry/designations are externally distributed?
5. Are any additional restrictions triggered by future external/public product exposure compared with authenticated internal use?
6. Confirm the required storage/geographic processing constraints for the intended production deployment.

These are **tolkningsfråga** until an external authority answers them.

## 8. Explicit non-claims

This document does not change OD-12-B.
It does not change the ADR-28A requirement that final licence meaning remains EXTERNAL.
It does not grant SYSTEM-PROVEN or PRODUCT-PROVEN.
It does not authorize public exposure, a new LM runtime path, a Source Registry mutation, or a database mutation.
It does not classify a person, owner or individual from LM data.

## 9. Follow-up units identified by facts

- Source Registry correction: replace unsupported `CC0` identity for Fastighetsindelning with terms-bound licence identity.
- Raw-property minimization audit: enumerate and justify/drop retained source keys.
- Attribution proof: bind required LM attribution into governed external report/map/PDF paths.
- Purpose-decision evidence: snapshot the exact LM application/decision text applicable to the account/product without exposing credentials.

OD-12 map state remains **EXTERNAL** after this mapping.
