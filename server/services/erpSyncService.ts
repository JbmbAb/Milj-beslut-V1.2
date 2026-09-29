import { logger } from '../logger';

export type ErpProvider = 'FORTNOX' | 'VISMA' | 'MOCK' | 'NOT_CONFIGURED';

export interface ErpConfig {
  provider: ErpProvider;
  apiKey?: string;
  endpoint?: string;
}

export interface ErpTransaction {
  id: string;
  projectId: string;
  amount: number;
  currency: string;
  description: string;
  milestoneId: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  sentAt?: Date;
  externalReference?: string;
}

function getErpConfig(): ErpConfig {
  const provider = (process.env.ERP_PROVIDER || 'NOT_CONFIGURED').toUpperCase() as ErpProvider;
  return {
    provider:
      provider === 'FORTNOX' || provider === 'VISMA' || provider === 'MOCK' ? provider : 'NOT_CONFIGURED',
    apiKey: process.env.ERP_API_KEY,
    endpoint: process.env.ERP_ENDPOINT,
  };
}

export async function syncMilestoneToErp(
  projectId: string,
  milestoneId: string,
  description: string,
  amount: number,
): Promise<ErpTransaction> {
  const config = getErpConfig();

  if (config.provider === 'NOT_CONFIGURED') {
    logger.warn(`ERP sync skipped for project ${projectId}: ERP_PROVIDER is not configured`);
    return {
      id: `mock-id-${Date.now()}`,
      projectId,
      amount,
      currency: 'SEK',
      description,
      milestoneId,
      status: 'FAILED',
    };
  }

  logger.info(`Initiating ERP sync to ${config.provider} for project ${projectId}, milestone ${milestoneId}`);

  // HD-02 (A9 sweep, 2026-09-29): FORTNOX and VISMA had no real integration ("Implement Fortnox
  // logic here" / "Implement Visma logic here" — nothing was ever sent), yet the function still
  // returned status: 'SENT' with a fabricated externalReference (`ERP-${Date.now()}`), so a caller
  // had no way to tell a real sync from one that never happened. MOCK stays honest: it is an
  // explicit, self-declared opt-in (ERP_PROVIDER=MOCK), unlike FORTNOX/VISMA which claim to be
  // real providers. Building the real Fortnox/Visma integration is a separate future unit.
  if (config.provider === 'MOCK') {
    logger.info('Mocking ERP sync...');
    return {
      id: `tx-${Date.now()}`,
      projectId,
      amount,
      currency: 'SEK',
      description,
      milestoneId,
      status: 'SENT',
      sentAt: new Date(),
      externalReference: `ERP-${Date.now()}`,
    };
  }

  logger.warn(
    `ERP sync NOT sent for project ${projectId}: ${config.provider} integration is not implemented (HD-02)`,
  );
  return {
    id: `tx-${Date.now()}`,
    projectId,
    amount,
    currency: 'SEK',
    description,
    milestoneId,
    status: 'FAILED',
  };
}
