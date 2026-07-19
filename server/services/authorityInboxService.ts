import { prisma } from '../../db.server';
import { logger } from '../logger';
import { SubmissionStatus, SubmissionChannel } from '../../src/domain/submission';

export enum AuthorityInboxEventType {
  ACKNOWLEDGEMENT = 'ACKNOWLEDGEMENT',
  STATUS_UPDATE = 'STATUS_UPDATE',
  DECISION = 'DECISION',
  INJUNCTION = 'INJUNCTION',
  COMPLEMENT_REQUEST = 'COMPLEMENT_REQUEST',
  GENERAL_MESSAGE = 'GENERAL_MESSAGE',
}

export interface InboundEventPayload {
  submissionId?: string;
  projectId: string;
  organisationId: string;
  sourceSystem: string;
  sourceChannel: SubmissionChannel;
  authorityName?: string;
  eventType: AuthorityInboxEventType;
  summary: string;
  payload: any;
  externalReference?: string;
  caseNumber?: string;
}

export class AuthorityInboxService {
  /**
   * Register an inbound event from an authority (webhook, email, polling)
   */
  async registerInboundEvent(event: InboundEventPayload): Promise<void> {
    const eventKey = `evt-${event.sourceSystem}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      await prisma.authorityInboxEvent.create({
        data: {
          eventKey,
          projectId: event.projectId,
          organisationId: event.organisationId,
          submissionId: event.submissionId,
          sourceSystem: event.sourceSystem,
          sourceChannel: event.sourceChannel as any,
          authorityName: event.authorityName,
          eventType: event.eventType as any,
          summary: event.summary,
          payload: event.payload,
          externalReference: event.externalReference,
          caseNumber: event.caseNumber,
          receivedAt: new Date(),
        },
      });

      // If this event is linked to a submission, update the submission status
      if (event.submissionId) {
        let newStatus: SubmissionStatus | null = null;

        if (event.eventType === AuthorityInboxEventType.ACKNOWLEDGEMENT) {
          newStatus = SubmissionStatus.RECEIVED;
        } else if (event.eventType === AuthorityInboxEventType.STATUS_UPDATE) {
          // Map authority status to our internal status if possible
          // For now, keep as RECEIVED or use a general PENDING_REVIEW
          newStatus = SubmissionStatus.PENDING_REVIEW;
        } else if (event.eventType === AuthorityInboxEventType.DECISION) {
          // Decisions might mean COMPLETED, REJECTED, etc.
          // For now, mark as PENDING_REVIEW for human-in-the-loop
          newStatus = SubmissionStatus.PENDING_REVIEW;
        }

        if (newStatus) {
          await prisma.submission.update({
            where: { id: event.submissionId },
            data: {
              status: newStatus as any,
              externalReference: event.externalReference || undefined,
              caseNumber: event.caseNumber || undefined,
              lastStatusAt: new Date(),
            },
          });

          await prisma.submissionStatusEvent.create({
            data: {
              submissionId: event.submissionId,
              status: newStatus as any,
              sourceSystem: event.sourceSystem,
              summary: event.summary,
              externalReference: event.externalReference,
              payload: event.payload,
              occurredAt: new Date(),
            },
          });
        }
      }

      logger.info('Authority inbound event registered', { eventKey, submissionId: event.submissionId });
    } catch (error) {
      logger.error('Failed to register authority inbound event', { error, eventKey });
      throw error;
    }
  }
}

export const authorityInbox = new AuthorityInboxService();
