/**
 * Fastighetsuppslag — referens för fortsatt utveckling
 *
 * - HTTP: `propertyLookupRouter` (server/routes/property.routes.ts) — monteras i createApp.ts.
 *   Använd inte duplicerade handlers i secureApi.express för samma paths.
 * - Lantmäteriet (licens): `lookupPropertyByDesignation` i server/services/lantmaterietService.ts
 * - PostGIS: `lookupPropertyByDesignationFromPostgis` i server/services/propertyUnitService.ts
 * - Admin connectivity: POST /api/admin/lantmateriet/test → testLantmaterietConnection (secureApi.express)
 * - Miljövariabler: se .env.example (LANTMATERIET_CONSUMER_KEY/SECRET, TOKEN_URL, BASE_URL, OGC_COLLECTION, …)
 */

export { lookupPropertyByDesignation } from '../services/lantmaterietService';
export { lookupPropertyByDesignationFromPostgis } from '../services/propertyUnitService';
export { default as propertyLookupRouter } from '../routes/property.routes';
