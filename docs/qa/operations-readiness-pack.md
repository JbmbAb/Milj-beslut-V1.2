# Driftklarhetspaket - Miljobeslut.se

Datum: 2026-03-02  
Version: 1.0  
Status: Aktivt underlag for driftgodkannande.

## Omfattning
Detta underlag täcker fyra obligatoriska driftspår:
1. Overvakning
2. Incidentrutin
3. Backup/restore
4. SLA-underlag

## 1) Overvakning
### Mål
- Upptacka fel snabbt i API, databaskoppling och kritiska integrationer.

### Minimikrav
1. Liveness endpoint: `GET /health`.
2. API-fel loggas med requestcontext.
3. Daglig kontroll av integrationstatus:
   - `GET /api/admin/dispatch/provider`
   - `GET /api/datasources/catalog`
4. Veckovis kontroll av audit-integritet:
   - `GET /api/audit/export`

### Verifiering
- Ref: `OPS_MONITORING_BASELINE_V1`

## 2) Incidentrutin
### Prioritetsnivaer
1. P1: Tjanst nere eller dataintegritet hotad.
2. P2: Kritisk delprocess blockerad.
3. P3: Avgransad funktionell avvikelse.

### Flode
1. Detektion (overvakning eller manuellt larm).
2. Klassning (P1/P2/P3).
3. Mitigering (tillfallig atgard).
4. Permanent fix.
5. Efteranalys med atgardspunkter.

### Krav pa dokumentation
1. Incident-ID
2. Start/sluttid
3. Paverkan
4. Rotorsak
5. Atgard
6. Forebyggande uppfoljning

### Verifiering
- Ref: `OPS_INCIDENT_PROCESS_V1`

## 3) Backup/restore
### Minimikrav
1. Daglig backup av databas.
2. Minst en verifierad restore-ovning per manad.
3. RPO <= 24h.
4. RTO <= 8h for P1.

### Restore-test (manuell checklista)
1. Starta isolerad testmiljo.
2. Aterlas senaste backup.
3. Verifiera nyckelentiteter:
   - projekt
   - stage-gates
   - audit trail
   - dispatch/journal/LIMS-data
4. Dokumentera resultat och avvikelser.

### Verifiering
- Ref: `OPS_BACKUP_RESTORE_V1`

## 4) SLA-underlag
### Tjansteniva (mal)
1. Tillganglighet: 99.5% per kalendermanad.
2. P1-respons: inom 1 timme.
3. P2-respons: inom 4 timmar.
4. P3-respons: inom 1 arbetsdag.

### Undantag
1. Planerat underhall enligt kommunicerat servicefonster.
2. Fel hos externa leverantorer utanfor kontroll.

### Verifiering
- Ref: `OPS_SLA_BASELINE_V1`

## Godkannandekriterium for punkt #33
1. Dokumentet finns i repo.
2. Alla fyra delomraden ar definierade.
3. Verifieringsrader finns for respektive delomrade.

## Verifieringsrad
Ref: `OPS_READINESS_PACK_V1_2026-03-02`
