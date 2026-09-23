# AUTONOMY-LEDGER-01
**SYFTE:** Kvantifiera och driva ner `LU_MANUAL_INTERVENTION_COUNT`. Dokumenterar exakt var plattformen idag kräver handpåläggning och vilket mandat som krävs för att automatisera steget.

**CURRENT LU_MANUAL_INTERVENTION_COUNT:** (TBD - fastställs vid nästa baslinjekörning)

| Operation | Nu (Nuvarande tillstånd) | Mål (Autonomt tillstånd) | Authority / Mandat | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Resursallokering (Lagring)** | Reaktiv (Varnar vid < 20 GB, kräver manuell städning) | Presumptiv reservering och autonom städning (Forecast) | Befintligt systemmandat | GAP (ref FD-001) |
| **Skapa Project Context** | Manuell / Worker | Unattended / API-drivet | Befintligt mandat | NÄRA KLAR |
| **Klassificera Dokument** | Delvis manuell bedömning | Automatisk kandidat + Human Verify | Kräver nytt delegationsmandat | SENARE |
| **Retry Transient Failure** | Delvis automatisk | Automatisk inom tidsfönster | Begränsat mandat | GAP |
| **Permanent Failure (Log)** | Ingen automatisk mutation | Flagga + Operator Queue | Mimer får ej mutera state utan lov | GAP |
