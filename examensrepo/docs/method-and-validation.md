# Metod och valideringsprotokoll

## Syfte
Sakerstalla att slutsatser i examensrapporten baseras pa verifierad, sparbar och reproducerbar data.

## Human-in-the-loop
1. Autoextraherade rader startar som preliminara.
2. Manuell verifiering kravs for kravrad och citat.
3. Slutrapport far endast baseras pa `VERIFIED`.

## Verifieringsregler
1. Kravrad maste ha:
- `Verifieringsstatus=VERIFIED`
- `VerifieradJaNej=Ja`
- `VerifieradAv` ifyllt
- `VerifieradDatum` ifyllt
2. Citation maste ha:
- `VerifieradJaNej=Ja`
- `VerifieradAv` ifyllt
- `VerifieradDatum` ifyllt
- `PageNumber` eller `Kommentar`
3. Fokuskategorier:
- `Ytkonstruktion`
- `DagvattenLakvatten`

Dessa ska dubbelgranskas och markeras med tydlig notering i `ValideringsKommentar`.

## Kvalitetsgate
Korskript:
```powershell
npm run verification:gate -- --dataset=./working/current
```

Gate failar om:
1. nagon rad inte ar `VERIFIED` i analyserad slutmangd
2. obligatoriska verifieringsfalt saknas
3. citation-sparet saknas

## Reproducerbarhet
1. Frys dataset med hash-manifest.
2. Spara release-manifest for rapportkornning.
3. Om underlag andras efter freeze: skapa ny version, skriv inte over tidigare.
