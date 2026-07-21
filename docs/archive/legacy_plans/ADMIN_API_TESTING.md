# Admin API Testing Guide

Guide för manuell testning av admin-modulernas API och WebSocket.

## Prerequisites

1. Backend körande: `npm run dev:server`
2. Frontend körande: `npm run dev`
3. Browser DevTools öppen

---

## HTTP API Testing

### Test 1: Hämta Projekt med Pagination

1. Öppna **Permit Portal** modul
2. Se tabellen fyllas med 10 projekt (första sidan)
3. Klicka **"Nästa"** knapp
4. Verifiera att nya projekt laddas
5. Check Network tab:
   - URL: `/api/admin/projects?page=2&limit=10`
   - Status: 200
   - Response har `"total"`, `"page": 2`, `"totalPages"`

### Test 2: Rate Limiting

1. Öppna Browser Console
2. Kör script:
   ```javascript
   for (let i = 0; i < 50; i++) {
     fetch('/api/admin/projects?page=1')
       .then((r) => r.json())
       .then((d) => console.log(`Request ${i + 1}:`, d.ok))
       .catch((e) => console.error(`Request ${i + 1}:`, e));
   }
   ```
3. Efter ~40 requests, se:
   - Status: 429 (Too Many Requests)
   - Response: `{ "error": "Too many requests", "retryAfter": 30 }`
   - Header: `X-RateLimit-Remaining: 0`

### Test 3: Transport Bookings Pagination

1. Öppna **Logistics** modul
2. Se transport-tabell med 10 bokningar
3. Klicka sidnummer 2
4. Verifiera nya bokningar laddas
5. Check Network: `/api/transport/bookings?page=2&limit=10`

---

## WebSocket Testing

### Test 4: CO₂ Real-time Updates

1. Öppna **Green Check** modul
2. Öppna Browser DevTools → Console
3. Kör:
   ```javascript
   const ws = new WebSocket('ws://localhost:8787/projects/proj-123/carbon');
   ws.onmessage = (e) => console.log('CO₂ Update:', JSON.parse(e.data));
   ws.onerror = (e) => console.error('Error:', e);
   ```
4. Verifiera:
   - WebSocket connects (Connection successful message)
   - Mottar initial CO₂-data
   - `totalKgCo2e`, `riskMetrics` finns

### Test 5: Transport Real-time Updates

1. Öppna Logistics modul
2. Öppna Browser Console
3. Kör:
   ```javascript
   const ws = new WebSocket('ws://localhost:8787/transport/updates');
   ws.onmessage = (e) => console.log('Transport Update:', JSON.parse(e.data));
   ws.onerror = (e) => console.error('Error:', e);
   ```
4. Verifiera:
   - WebSocket connects
   - Mottar initial bookings-lista
   - Kan se `type: 'initial-data'`

### Test 6: WebSocket Reconnection

1. Starta WebSocket-anslutning (Test 4)
2. Koppla bort nätverket (DevTools → Network → Offline)
3. Verifiera WebSocket reconnects automatiskt efter ~1 sekund
4. Koppla på nätverket igen
5. Verifiera uppdateringar mottas igen

### Test 7: WebSocket Manual Update Request

1. Starta WebSocket (Test 4)
2. Skicka update-request:
   ```javascript
   ws.send(JSON.stringify({ type: 'request-update' }));
   ```
3. Verifiera server svarar med uppdaterad CO₂-data

---

## React Query Caching Testing

### Test 8: Cache Validation

1. Öppna Permit Portal
2. Se projekt laddas (Network: 200)
3. Navigera till annan modul och tillbaka
4. Verifiera projekt **inte** laddas igen (Network: cache hit)
5. Vänta 5+ minuter
6. Verifiera data uppdateras (Network: 200 med nya data)

### Test 9: Stale While Revalidate

1. Öppna Permit Portal
2. Se initial projekt (Network: 200)
3. Navigera bort + tillbaka inom 5 minuter
4. Verifiera:
   - **Gamla data** visas omedelbar (från cache)
   - **Bakgrund-request** startar
   - **Nya data** uppdaterar när det kommer (inom 1-2 sek)

---

## Error Handling Testing

### Test 10: API Error Handling

1. Stäng backend server
2. Öppna admin modul
3. Verifiera:
   - LoadingSpinner visas
   - Error-alert: "Fel vid hämtning av projekt"
   - Kan stänga error-meddelande

### Test 11: WebSocket Error Handling

1. Öppna WebSocket-anslutning (Test 4)
2. Simulera server-fel: stäng backend
3. Verifiera:
   - Anslutning stängs (`ws.onclose`)
   - Försöker reconnecta (exponential backoff)
   - Loggar `[WebSocket] Reconnecting in Xms`

---

## Performance Testing

### Test 12: Large Pagination

1. Öppna Permit Portal
2. Go to page 10 (100 projekt hoppat över)
3. Check URL: `?page=10&limit=10`
4. Verifiera response-tid < 500ms
5. Test page-jump från 1 till 5 (multiple jumps)

### Test 13: WebSocket Performance

1. Öppna 3+ WebSocket-anslutningar:
   ```javascript
   const wss = [];
   for (let i = 0; i < 3; i++) {
     const ws = new WebSocket('ws://localhost:8787/transport/updates');
     wss.push(ws);
   }
   ```
2. Verifiera all anslutningar mottar updates
3. Check server log för `Broadcasted update to N clients`

---

## Accessibility Testing (WCAG 2.1 AA)

### Test 14: Keyboard Navigation Pagination

1. Öppna Permit Portal
2. Tab till "Föregående" knapp (disabled om på page 1)
3. Tab till sida-nummer (ex: "3")
4. Tryck Space/Enter → navigate till page 3
5. Tab till "Nästa" knapp
6. Verifiera focus-highlighting synlig

### Test 15: Screen Reader

1. Öppna Narrator/NVDA
2. Navigate Pagination:
   - Hör: "Navigation, Pagination"
   - Hör: "Button, Previous page, disabled"
   - Hör: "Button, Page 1 of 10, selected"
   - Hör: "Button, Page 2 of 10"
   - Hör: "Paragraph, Page 1 of 10" (live update)

---

## Checklist for Production

- [ ] Alla HTTP-endpoints returnerar korrekt pagination
- [ ] Rate limiting fungerar (429 response)
- [ ] WebSocket reconnects automatiskt
- [ ] React Query cache fungerar (5 min stale time)
- [ ] Error-handling visar user-friendly messages
- [ ] Keyboard navigation av pagination fungerar
- [ ] Screen reader read pagination labels
- [ ] Performance: API-response < 500ms
- [ ] Performance: WebSocket-message < 100ms
- [ ] Sentry captures errors (check Sentry dashboard)

---

## Troubleshooting

### WebSocket Connection Fails

**Problem:** WebSocket gives `connection refused`

**Solution:**

1. Verifiera backend kör: `npm run dev:server`
2. Kontroller WebSocket port är inte blockerad
3. Verifiera URL är korrekt: `ws://localhost:8787` (inte `wss://` för dev)
4. Check browser console för error-meddelanden

### Pagination Not Working

**Problem:** "Nästa" knapp grayed ut eller pages inte laddar

**Solution:**

1. Check `/api/admin/projects` endpoint returerar data
2. Verifiera `totalItems` är > 10
3. Check React Query DevTools (install react-query-devtools)
4. Verifiera `limit` query-parameter skickas

### Cache Not Updating

**Problem:** Gamla data visas även efter 5+ minuter

**Solution:**

1. Verifiera `staleTime: 5 * 60 * 1000` i QueryClient setup
2. Verifiera `refetchOnWindowFocus` är false
3. Manuellt refetch: `queryClient.invalidateQueries()`

---

## Monitoring

### Sentry Dashboard

1. Gå till `https://sentry.io`
2. Logga in med ditt konto
3. Verifiera projekt mottog errors
4. Check error breadcrumbs + context

### Server Logs

```bash
# Terminal där backend kör
# Se WebSocket-meddelanden:
[WebSocket] New connection: /projects/proj-123/carbon
[WebSocket] Client connected to project proj-123. Total: 1
[CarbonWS] Broadcasted update to project proj-123. Clients: 1
```

---

## Notes

- Alla tester bör köras mot dev-miljö först
- Innan prod-release: kör full QA-suite
- Document any anomalies för backend-teamet
