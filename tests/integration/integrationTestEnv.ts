import { describe } from 'vitest';

function isEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export const databaseIntegrationEnabled = isEnabled(process.env.DATABASE_INTEGRATION);
export const liveSmhiIntegrationEnabled =
  isEnabled(process.env.LIVE_SMHI_INTEGRATION) || isEnabled(process.env.SMHI_LIVE_INTEGRATION);

// External integration suites are opt-in so the default verification stays deterministic.
export const describeIfDatabaseIntegration = databaseIntegrationEnabled ? describe : describe.skip;
export const describeIfLiveSmhiIntegration = liveSmhiIntegrationEnabled ? describe : describe.skip;
