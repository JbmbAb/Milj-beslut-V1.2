# Admin API Documentation

Dokumentation för admin-modulernas API-endpoints och WebSocket-anslutningar.

## Base URL

```
HTTP: http://localhost:8787/api
WebSocket: ws://localhost:8787
```

---

## HTTP Endpoints

### Pagination Endpoints

#### GET /api/admin/projects

Hämtar pagerad lista över miljöprojekt.

**Query Parameters:**

- `page` (integer, default: 1) - Sidnummer
- `limit` (integer, default: 10, max: 100) - Projekt per sida

**Response:**

```json
{
  "ok": true,
  "projects": [
    {
      "id": "proj-123",
      "propertyDesignation": "Västra vägen 42",
      "status": "ACTIVE",
      "createdAt": "2026-03-15T10:00:00Z",
      "complianceScore": 85,
      "environmentalScore": 72,
      "regulatoryRiskScore": 35,
      "fundingRating": "A"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 10,
  "totalPages": 15,
  "hasMore": true
}
```

**Rate Limit:** 40 requests/minute per user

---

#### GET /api/transport/bookings

Hämtar pagerad lista över transporter.

**Query Parameters:**

- `page` (integer, default: 1) - Sidnummer
- `limit` (integer, default: 10, max: 100) - Transporter per sida

**Response:**

```json
{
  "ok": true,
  "bookings": [
    {
      "id": "booking-123",
      "status": "IN_TRANSIT",
      "receiverName": "Gävle Avfallsanläggning",
      "wasteCode": "19 02 05",
      "tons": 25.5,
      "distanceKm": 145,
      "co2EstimateKg": 2890,
      "plannedPickupAt": "2026-04-03T08:00:00Z",
      "plannedDeliveryAt": "2026-04-03T14:00:00Z",
      "createdAt": "2026-04-02T15:30:00Z",
      "updatedAt": "2026-04-02T16:45:00Z"
    }
  ],
  "total": 342,
  "page": 1,
  "limit": 10,
  "totalPages": 35,
  "hasMore": true
}
```

**Rate Limit:** 60 requests/minute per user

---

## WebSocket Endpoints

### Carbon Updates: `/projects/{projectId}/carbon`

Real-time CO₂ och risk-metriker för ett projekt.

**Connection:**

```javascript
const ws = new WebSocket('ws://localhost:8787/projects/proj-123/carbon');
```

**Server → Client (Initial Data):**

```json
{
  "type": "carbon-update",
  "projectId": "proj-123",
  "result": {
    "totalKgCo2e": 6200,
    "quality": "CALCULATED",
    "method": "DATABASE"
  },
  "riskMetrics": [
    {
      "name": "Regulatorisk Risk",
      "score": 35,
      "threshold": 50,
      "status": "low"
    },
    {
      "name": "Miljöpåverkan",
      "score": 62,
      "threshold": 75,
      "status": "medium"
    },
    {
      "name": "Finansiell Hälsa",
      "score": 82,
      "threshold": 75,
      "status": "high"
    }
  ],
  "timestamp": "2026-04-02T16:50:00Z"
}
```

**Client → Server (Request Update):**

```json
{
  "type": "request-update"
}
```

---

### Transport Updates: `/transport/updates`

Real-time uppdateringar för alla transporter.

**Connection:**

```javascript
const ws = new WebSocket('ws://localhost:8787/transport/updates');
```

**Server → Client (Initial Data):**

```json
{
  "type": "initial-data",
  "bookings": [
    {
      "id": "booking-123",
      "status": "IN_TRANSIT",
      "updatedAt": "2026-04-02T16:45:00Z"
    }
  ],
  "timestamp": "2026-04-02T16:50:00Z"
}
```

**Server → Client (Transport Update):**

```json
{
  "type": "transport-update",
  "bookingId": "booking-123",
  "updates": {
    "status": "DELIVERED",
    "location": {
      "lat": 60.6749,
      "lng": 17.1412
    },
    "lastUpdate": "2026-04-02T16:55:00Z"
  },
  "timestamp": "2026-04-02T16:55:00Z"
}
```

---

## Error Handling

### HTTP Error Responses

```json
{
  "ok": false,
  "error": "Too many requests, please try again later",
  "retryAfter": 30
}
```

### Rate Limit Headers

```
X-RateLimit-Limit: 40
X-RateLimit-Remaining: 35
X-RateLimit-Reset: 1712078400
```

---

## Environment Variables

Lägg till dessa i `.env` för att aktivera produktionsfunktioner:

```env
# Sentry Error Tracking
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Node Environment
NODE_ENV=production
```

---

## Examples

### Hämta första sidan av projekt (curl)

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:8787/api/admin/projects?page=1&limit=10"
```

### Subscribe till CO₂-uppdateringar (JavaScript)

```typescript
import { useWebSocket } from '@/components/admin/hooks';

const Component = () => {
  const { isConnected } = useWebSocket('ws://localhost:8787/projects/proj-123/carbon', {
    onMessage: (data) => {
      console.log('CO₂ Update:', data.result.totalKgCo2e);
    },
    reconnect: true,
    maxReconnectAttempts: 5,
  });

  return <div>{isConnected ? 'Connected' : 'Disconnected'}</div>;
};
```

---

## Performance Tips

1. **Pagination**: Alltid paginera stora datasets (max 100 items/sida)
2. **Caching**: React Query cachar data i 5 minuter automatiskt
3. **WebSocket**: Använd automatic reconnect för prod-miljö
4. **Rate Limiting**: Respektera rate-limit headers för att undvika throttling

---

## Support

Kontakta backend-teamet för API-support eller error-rapportering.
