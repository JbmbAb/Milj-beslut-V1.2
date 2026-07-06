# Admin Integration Status Report

**Datum:** 2026-04-02 | **Status:** ⚠️ DELVIS IMPLEMENTERAD

---

## 🎯 Executive Summary

| Aspekt                      | Status        | Detaljer                                            |
| --------------------------- | ------------- | --------------------------------------------------- |
| **UI Komponenter**          | ✅ KLARA      | Alla 5 moduler implementerade                       |
| **React Query Setup**       | ✅ KLARA      | QueryClientProvider + hooks skapade                 |
| **React Query Integration** | ❌ INTE AKTIV | Moduler använder GAMLA hooks istället               |
| **WebSocket Server**        | ✅ KLARA      | carbonUpdates, transportUpdates setup               |
| **WebSocket Client**        | ❌ INTE AKTIV | Hooks finns men ej integrerade i moduler            |
| **API Endpoints**           | ✅ DELVIS     | Pagination finns; projektplan/VA-ansökningar saknas |
| **Pagination**              | ✅ AKTIV      | Permit Portal + Logistics                           |
| **SEO & Metadata**          | ✅ AKTIV      | useAdminPageMeta fungerar                           |
| **Error Tracking**          | ✅ KLARA      | Sentry setup + Handles                              |

---

## 📊 Modul-per-Modul Status

### 1. Core Tillståndsportal (Permit Portal) ✅ 3/5

```
┌─────────────────────────────────────────┐
│ Permit Portal - Status                  │
├─────────────────────────────────────────┤
│ UI                        ✅ Implementerad│
│ Old Hook (useAdminProjects) ✅ Aktiv     │
│ React Query              ✅ Finns (ej använd)|
│ WebSocket               ❌ Saknas        │
│ Pagination              ✅ AKTIV         │
│ API Integration         ✅ Fungerar      │
└─────────────────────────────────────────┘

Nuvarande:
- useAdminProjects (useState/useEffect)
- Hämtar projects från /api/admin/projects
- Pagination fungerar (10 items/sida)

Fattas:
- Byt till useAdminProjectsQuery (React Query)
- WebSocket för live-uppdateringar
- Cache-invalidering vid ändringar
```

### 2. Logistik & Massa (Logistics) ✅ 3/5

```
┌─────────────────────────────────────────┐
│ Logistics - Status                      │
├─────────────────────────────────────────┤
│ UI                        ✅ Implementerad│
│ Old Hook (useTransportBookings) ✅ Aktiv │
│ React Query             ✅ Finns (ej använd)|
│ WebSocket              ❌ Saknas         │
│ Pagination             ❌ SAKNAS        │
│ API Integration        ✅ Fungerar (pagination)|
└─────────────────────────────────────────┘

Nuvarande:
- useTransportBookings (useState/useEffect)
- Hämtar bookings från /api/transport/bookings
- Laddar ALLA bookings (no pagination)

Fattas:
- Byt till useTransportBookingsQuery (React Query)
- Lägg till pagination (10 items/sida)
- WebSocket för live transport-status (finns: /transport/updates)
- GPS-tracking (real-time position updates)
```

### 3. Projektplan ❌ 2/5

```
┌─────────────────────────────────────────┐
│ ProjectPlan - Status                    │
├─────────────────────────────────────────┤
│ UI                        ✅ Implementerad│
│ Old Hook (useProjectPlan) ✅ Aktiv       │
│ React Query             ✅ Finns (ej använd)|
│ WebSocket              ❌ Saknas         │
│ API Endpoint           ❌ SAKNAS         │
│ Live Updates           ❌ SAKNAS         │
└─────────────────────────────────────────┘

Nuvarande:
- useProjectPlan (useState/useEffect)
- Hämtar från /api/projects/:projectId/plan
- ❌ ENDPOINT SAKNAS (404)

Kritiska Sakningar:
- ❌ API-endpoint implementerad
- ❌ useProjectPlanQuery inte använd
- ❌ WebSocket för fase-uppdateringar
- ❌ Real-time stakeholder-status
```

### 4. Grönkoll för Banker (Green Check) ❌ 2/5

```
┌─────────────────────────────────────────┐
│ GreenCheck - Status                     │
├─────────────────────────────────────────┤
│ UI                        ✅ Implementerad│
│ Old Hook (useCarbonMetrics) ✅ Aktiv    │
│ React Query            ✅ Finns (ej använd)|
│ WebSocket             ✅ Server ready   │
│ API Endpoint          ✅ Delvis (CO₂-data|
│ Live CO₂ Updates      ⚠️ Ser inte ut    │
└─────────────────────────────────────────┘

Nuvarande:
- useCarbonMetrics (useState/useEffect)
- Hämtar mock CO₂-data
- ❌ Använder inte WebSocket /projects/:id/carbon

Fattas:
- Byt till useCarbonMetricsQuery (React Query)
- Integrera useCarbonWebSocket för real-time CO₂
- ESG-rating API-endpoint
- Risk-metrics live updates
```

### 5. Enskilt Avlopp (Sewage Portal) ❌ 2/5

```
┌─────────────────────────────────────────┐
│ SewagePortal - Status                   │
├─────────────────────────────────────────┤
│ UI                        ✅ Implementerad│
│ Old Hook (useAdminProjects) ✅ Aktiv    │
│ React Query            ✅ Finns (ej använd)|
│ WebSocket             ❌ Saknas         │
│ API Endpoint          ❌ SAKNAS         │
│ Dedicated Model       ❌ Fallback Only  │
└─────────────────────────────────────────┘

Nuvarande:
- Använder Project-model som fallback
- useAdminProjects istället för dedikerad hook
- ❌ API /api/sewage-applications saknas

Fattas:
- Dedikerad SewageApplication-API
- useAdminSewageApplicationsQuery hook
- Pagination för VA-ansökningar
- WebSocket för ansökningsstatus
```

---

## 🔴 KRITISKA GAP

### Gap #1: React Query INTE Integrerad ⚠️ HIGH

**Problem:**

```typescript
// Alla moduler använder gamla hooks
const { projects, loading, error } = useAdminProjects(); // ❌ Ingen caching

// Men vi har React Query versions som INTE används
const { data } = useAdminProjectsQuery(); // ✅ Finns men inte använd
```

**Impact:**

- ❌ Ingen automatic caching (data refetch on every mount)
- ❌ Ingen stale-while-revalidate
- ❌ Ingen deduplicering av requests
- ❌ Network overhead ↑

**Fix Priority:** 🔴 HIGH (< 2 timmar)

---

### Gap #2: WebSocket INTE Aktiverad ⚠️ HIGH

**Problem:**

```typescript
// WebSocket server är setup men INTE använd av frontend
// /projects/:id/carbon → ingen modul listening
// /transport/updates → ingen modul listening
```

**Impact:**

- ❌ Ingen live CO₂-uppdateringar
- ❌ Ingen live transport-status
- ❌ Ingen real-time projektplan-sync
- ❌ HelaReal-time-systemet INAKTIVT

**Fix Priority:** 🔴 HIGH (< 3 timmar)

---

### Gap #3: API Endpoints Saknas ⚠️ MEDIUM

| Endpoint                   | Status     | Modul         |
| -------------------------- | ---------- | ------------- |
| `/api/admin/projects`      | ✅ EXISTS  | Permit Portal |
| `/api/transport/bookings`  | ✅ EXISTS  | Logistics     |
| `/api/projects/:id/plan`   | ❌ MISSING | ProjectPlan   |
| `/api/sewage-applications` | ❌ MISSING | SewagePortal  |
| `/api/projects/:id/carbon` | ❌ MISSING | GreenCheck    |

**Fix Priority:** 🟠 MEDIUM (< 2 timmar)

---

## 📋 Implementation Checklist

### Phase 1: Migrate to React Query (1-2 timmar)

- [ ] Update PermitPortalModule.tsx
  - [ ] Import useAdminProjectsQuery instead of useAdminProjects
  - [ ] Update component logic to use query.data
  - [ ] Verify caching works

- [ ] Update LogisticsModule.tsx
  - [ ] Import useTransportBookingsQuery
  - [ ] Add pagination support
  - [ ] Update stats calculation

- [ ] Update ProjectPlanModule.tsx
  - [ ] Import useProjectPlanQuery
  - [ ] Update component logic

- [ ] Update GreenCheckModule.tsx
  - [ ] Import useCarbonMetricsQuery
  - [ ] Update KPI calculations

- [ ] Update SewagePortalModule.tsx
  - [ ] Create useAdminSewageApplicationsQuery
  - [ ] Create API endpoint /api/sewage-applications

### Phase 2: Integrate WebSocket (1-2 timmar)

- [ ] ProjectPlanModule.tsx
  - [ ] Add useWebSocket for /projects/:id/plan
  - [ ] Create usePlanWebSocket hook
  - [ ] Real-time fase updates

- [ ] GreenCheckModule.tsx
  - [ ] Add useCarbonWebSocket hook
  - [ ] Listen to /projects/:id/carbon
  - [ ] Real-time CO₂ updates

- [ ] LogisticsModule.tsx
  - [ ] Add useTransportWebSocket hook
  - [ ] Listen to /transport/updates
  - [ ] Real-time GPS + status

- [ ] SewagePortalModule.tsx
  - [ ] Add WebSocket for VA-status
  - [ ] Real-time ansöknings-uppdateringar

### Phase 3: API Endpoints (1-2 timmar)

- [ ] Create `/api/projects/:id/plan` endpoint
- [ ] Create `/api/sewage-applications` endpoint
- [ ] Create `/api/projects/:id/carbon` endpoint
- [ ] All endpoints with pagination support

---

## 🚀 Rekommendation

**Status:** ⚠️ INTE PRODUCTION-READY

Modulerna har UI men **saknar live-integrationer**.

**Nästa Steg:**

1. **Prioritera React Query migrering** (alla moduler inom 2h)
2. **Aktivera WebSocket-subscriptions** (green check + logistics inom 3h)
3. **Implementera saknade API-endpoints** (projektplan + avlopp inom 2h)
4. **Full QA & testing** (30 min)

**Total tid:** ~7-8 timmar för full produktion

---

## 📞 Kontroll-frågor

Före du initierar migrering, bekräfta:

1. Ska Projektplan använda WebSocket för live fase-uppdateringar?
2. Behövs GPS-tracking realtime för Logistics?
3. Hur ofta ska CO₂-data uppdateras (per transport, per timme)?
4. Vad är källa för SewageApplication-data (egen tabell eller Project-fallback)?

Svara med **FORTSÄTT** för att starta Fas 1 (React Query migration).
