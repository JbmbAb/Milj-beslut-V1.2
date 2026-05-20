# Legacy Code Archive

Detta katalog innehåller kod som inte längre är en del av produktions-kodbas men bevaras för referens.

## Struktur

### experimental/
Experimentella moduler som aldrig integrerades i produktion.

**Innehåll:**
- `gpsTrackingService.ts` - GPS-spårning för logistik (backend fanns, inget UI)
- `marketIntelService.ts` - Marknadsdata-integration (backend fanns, inget UI)
- `bankComplianceProfileService.ts` - ESG-scoring för banker (förberedd men aldrig använd)

**Beslut:** Arkiverat 2026-04-02
**Skäl:** Backend-implementation utan frontend-integration i 60+ dagar. Oklart affärscase.

### remix-poc/
Proof-of-concept Remix routing som aldrig togs i drift.

**Innehåll:**
- Hela `/app/routes/` katalogen (11 Remix route-filer)

**Beslut:** Kasserat 2026-04-02
**Skäl:** Parallell arkitektur till Express routes som aldrig användes i produktion.

---

## Om du behöver något från legacy/

1. **Kontrollera först** om funktionalitet redan finns i produktions-kod
2. **Extrahera konceptet**, inte koden direkt
3. **Skriv om** med nuvarande arkitektur
4. **Lägg till tester** från början
5. **Dokumentera** i modulregistret

---

**Skapad:** 2026-04-02
**Syfte:** Förhindra att experimentell kod blandas med produktion
