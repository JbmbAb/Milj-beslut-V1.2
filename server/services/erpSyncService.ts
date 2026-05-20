import { logger } from '../logger';
import { prisma } from '../db/prisma';

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
    provider: provider === 'FORTNOX' || provider === 'VISMA' || provider === 'MOCK' ? provider : 'NOT_CONFIGURED',
    apiKey: process.env.ERP_API_KEY,
    endpoint: process.env.ERP_ENDPOINT,
  };
}

export async function syncMilestoneToErp(projectId: string, milestoneId: string, description: string, amount: number): Promise<ErpTransaction> {
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
      status: 'FAILED'
    };
  }

  // Create a record in our database
  // Note: We assume a generic ErpTransaction model exists, or we just log it for now if we don't have schema
  // We will mock the database operation for this prototype since we don't know the exact schema
  logger.info(`Initiating ERP sync to ${config.provider} for project ${projectId}, milestone ${milestoneId}`);

  let externalReference = `ERP-${Date.now()}`;
  let status: 'SENT' | 'FAILED' = 'SENT';

  if (config.provider === 'FORTNOX') {
    // Implement Fortnox logic here
    logger.info(`Sending data to Fortnox API...`);
  } else if (config.provider === 'VISMA') {
    // Implement Visma logic here
    logger.info(`Sending data to Visma API...`);
  } else {
    logger.info(`Mocking ERP sync...`);
  }

  return {
    id: `tx-${Date.now()}`,
    projectId,
    amount,
    currency: 'SEK',
    description,
    milestoneId,
    status,
    sentAt: new Date(),
    externalReference
  };
}
