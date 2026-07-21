/**
 * INTEGRATION STATUS DOMAIN
 * Representerar hälsostatus och senaste aktivitet för en extern integration.
 */

export enum IntegrationHealth {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
  UNKNOWN = 'UNKNOWN',
}

export interface IntegrationStatus {
  id: string; // T.ex. "lantmateriet-api"
  name: string; // T.ex. "Lantmäteriet API"
  health: IntegrationHealth;
  lastCheckedAt: Date;
  lastSuccessAt?: Date;
  lastErrorAt?: Date;
  lastErrorMessage?: string;
  endpoint: string;
  metadata?: Record<string, any>;
}
