export enum SubmissionStatus {
  PREPARED = 'PREPARED',
  DISPATCHED = 'DISPATCHED',
  DELIVERED = 'DELIVERED',
  RECEIVED = 'RECEIVED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

export enum SubmissionChannel {
  REST = 'REST',
  EMAIL = 'EMAIL',
  WEBHOOK = 'WEBHOOK',
  PORTAL = 'PORTAL',
  MANUAL = 'MANUAL',
}

export enum SubmissionArtifactRole {
  PRIMARY_DOCUMENT = 'PRIMARY_DOCUMENT',
  ATTACHMENT = 'ATTACHMENT',
  RECEIPT = 'RECEIPT',
  DECISION = 'DECISION',
  INJUNCTION = 'INJUNCTION',
  COMPLEMENT_REQUEST = 'COMPLEMENT_REQUEST',
  OTHER = 'OTHER',
}

export interface Submission {
  id: string;
  submissionKey: string;
  projectId: string;
  organisationId: string;
  requirementCaseId?: string | null;
  domain: string;
  authorityName: string;
  authorityType?: string | null;
  recipientCode?: string | null;
  recipientChannel: SubmissionChannel;
  status: SubmissionStatus;
  externalReference?: string | null;
  caseNumber?: string | null;
  submittedBy?: string | null;
  submittedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmissionArtifact {
  id: string;
  submissionId: string;
  documentId?: string | null;
  role: SubmissionArtifactRole;
  label?: string | null;
  diskPath?: string | null;
  mimeType?: string | null;
  fileSha256?: string | null;
  sizeBytes?: bigint | null;
  sourceType?: string | null;
}

export interface SubmissionStatusEvent {
  id: string;
  submissionId: string;
  status: SubmissionStatus;
  sourceSystem: string;
  summary?: string | null;
  externalReference?: string | null;
  occurredAt: Date;
}
