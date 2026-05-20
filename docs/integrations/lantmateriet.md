# Lantmäteriet-integrationer

Miljöbeslut är godkänd för alla **avgiftsfria** Lantmäteriet-tjänster.
Detta dokument listar varje produkt, format, och vilken miljövariabel som
behövs.

> En **enda** prenumerationsnyckel (`LANTMATERIET_OPEN_SUBSCRIPTION_KEY`) räcker
> normalt för alla OGC Features + WMTS/WMS-produkter. Bulk-Atom-feeds kräver
> ingen nyckel alls.

## Översikt per produkt

| Produkt                     | Format           | Nyckel krävs? | Default-endpoint                                             |
| --------------------------- | ---------------- | ------------- | ------------------------------------------------------------ |
| Fastighetsindelning (öppen) | OGC API Features | Ja            | `api.lantmateriet.se/ogc-features/v1/fastighetsindelning`    |
| Belägenhetsadress (öppen)   | OGC API Features | Ja            | `api.lantmateriet.se/ogc-features/v1/belagenhetsadress`      |
| Ortnamn (öppen)             | OGC API Features | Ja            | `api.lantmateriet.se/ogc-features/v1/ortnamn`                |
| Administrativ indelning     | OGC API Features | Ja            | `api.lantmateriet.se/ogc-features/v1/administrativindelning` |
| Topografisk webbkarta       | WMTS             | Ja            | `api.lantmateriet.se/open/topowebb-ccby/v1/wmts`             |
| Ortofoto                    | WMS              | Ja            | `api.lantmateriet.se/open/ortofoto-ccby/v1/wms`              |
| Terrängskuggning            | WMS              | Ja            | `api.lantmateriet.se/open/terrangskuggning/v1/wms`           |
| Höjdmodell + laserdata      | Atom feed (bulk) | Nej           | `download-opendata.lantmateriet.se/`                         |
| Höjdgrid 2+/50+             | Atom feed (bulk) | Nej           | `download-opendata.lantmateriet.se/`                         |

## Konfiguration

I `.env` eller Cloud Run-secrets:

```bash
# Enda obligatoriska nyckeln för alla OGC-/WMS-produkter
LANTMATERIET_OPEN_SUBSCRIPTION_KEY=din-prenumerationsnyckel

# Valfri: endpoints om du vill peka om till annan miljö (beta, proxy etc.)
LANTMATERIET_OPEN_FASTIGHET_URL=https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning
# (se .env.example för fullständig lista)
```

## Endpoints i plattformen

- `GET /api/datasources/lantmateriet/open/catalog` — Lista alla produkter (publik).
- `GET /api/datasources/lantmateriet/open/ping` — Pinga alla produkter samtidigt (admin-auth).
- `GET /api/datasources/lantmateriet/open/ping/:product` — Ping en specifik produkt.
- `GET /api/datasources/lantmateriet/open/status` — Enkel status för topowebb WMTS.

## Typisk anropsmall (OGC API Features)

```http
GET https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradesytor/items?bbox=17.55,59.82,17.75,59.92&limit=10&subscription-key=XXX
Accept: application/geo+json
```

## Fastighetsuppslag vs. fri sökning

- **Fastighetsuppslag via beteckning** (betalad produkt `Fastighet och samfällighet Direkt`)
  använder `lantmaterietService.lookupPropertyByDesignation` och kräver
  `LANTMATERIET_CONSUMER_KEY + LANTMATERIET_CONSUMER_SECRET` (OAuth2).
- **Avgiftsfri OGC-featuressökning** använder `lantmaterietOpenDataService`
  och räcker normalt med `LANTMATERIET_OPEN_SUBSCRIPTION_KEY`.

I hybrid-läge (`PROPERTY_LOOKUP_MODE=hybrid`) försöker plattformen först PostGIS,
sedan **avgiftsfri fastighetsindelning OGC** med `LANTMATERIET_OPEN_SUBSCRIPTION_KEY`,
och först därefter **OAuth2/betalda** uppslag (`LANTMATERIET_CONSUMER_KEY` m.fl.).

## Smoketest

```bash
# Mot lokal server
npm run smoke:integrations

# Direkt mot Lantmäteriet via miljövariabler (utan server igång)
curl "https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections?subscription-key=$LANTMATERIET_OPEN_SUBSCRIPTION_KEY"
```

## Licens

Öppna data från Lantmäteriet är CC-BY — ange attribution "© Lantmäteriet" vid
visning i UI.
