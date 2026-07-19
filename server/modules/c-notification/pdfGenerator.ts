import type { AuthUser } from '../../security/types';
import { generateDocumentsForCase } from '../c-notification-mass/massOrchestrator';

export async function generateCNotificationPdf(caseId: string, authUser: AuthUser) {
  return generateDocumentsForCase(caseId, authUser);
}
