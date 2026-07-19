import type { AuthUser } from '../../security/types';
import { upsertMassOperations } from '../c-notification-mass/massOrchestrator';

export async function buildCNotificationCase(input: {
  caseId?: string;
  authUser: AuthUser;
  payload: unknown;
}) {
  return upsertMassOperations(input.caseId, input.authUser, input.payload as any);
}
