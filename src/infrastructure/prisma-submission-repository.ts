import { prisma } from '../../db.server';
import {
  Submission,
  SubmissionArtifact,
  SubmissionStatusEvent,
  SubmissionStatus,
  SubmissionChannel,
} from '../domain/submission';
import { ISubmissionRepository } from '../domain/submission-repository.interface';

export class PrismaSubmissionRepository implements ISubmissionRepository {
  async findById(id: string): Promise<Submission | null> {
    const s = await prisma.submission.findUnique({ where: { id } });
    return s ? this.mapToDomain(s) : null;
  }

  async findByKey(submissionKey: string, organisationId?: string): Promise<Submission | null> {
    const s = await prisma.submission.findFirst({
      where: {
        submissionKey,
        ...(organisationId ? { organisationId } : {}),
      },
    });
    return s ? this.mapToDomain(s) : null;
  }

  async findByProject(projectId: string): Promise<Submission[]> {
    const submissions = await prisma.submission.findMany({ where: { projectId } });
    return submissions.map((s) => this.mapToDomain(s));
  }

  async save(submission: Submission): Promise<Submission> {
    const data: any = {
      submissionKey: submission.submissionKey,
      projectId: submission.projectId,
      organisationId: submission.organisationId,
      requirementCaseId: submission.requirementCaseId,
      domain: submission.domain,
      authorityName: submission.authorityName,
      authorityType: submission.authorityType,
      recipientCode: submission.recipientCode,
      recipientChannel: submission.recipientChannel as any,
      status: submission.status as any,
      externalReference: submission.externalReference,
      caseNumber: submission.caseNumber,
      submittedBy: submission.submittedBy,
      submittedAt: submission.submittedAt,
    };

    const upserted = await prisma.submission.upsert({
      where: { submissionKey: submission.submissionKey },
      update: data,
      create: { ...data, id: submission.id },
    });

    return this.mapToDomain(upserted);
  }

  async addArtifact(artifact: Omit<SubmissionArtifact, 'id'>): Promise<SubmissionArtifact> {
    const created = await prisma.submissionArtifact.create({
      data: {
        submissionId: artifact.submissionId,
        documentId: artifact.documentId,
        role: artifact.role as any,
        label: artifact.label,
        diskPath: artifact.diskPath,
        mimeType: artifact.mimeType,
        fileSha256: artifact.fileSha256,
        sizeBytes: artifact.sizeBytes,
      },
    });

    return created as any;
  }

  async logStatusEvent(event: Omit<SubmissionStatusEvent, 'id'>): Promise<SubmissionStatusEvent> {
    const created = await prisma.submissionStatusEvent.create({
      data: {
        submissionId: event.submissionId,
        status: event.status as any,
        sourceSystem: event.sourceSystem,
        summary: event.summary,
        externalReference: event.externalReference,
        occurredAt: event.occurredAt,
      },
    });

    return this.mapStatusEventToDomain(created);
  }

  async getSubmissionWithEvents(
    id: string,
  ): Promise<Submission & { events: SubmissionStatusEvent[]; artifacts: SubmissionArtifact[] }> {
    const s = await prisma.submission.findUnique({
      where: { id },
      include: {
        statusEvents: true,
        artifacts: true,
      },
    });

    if (!s) throw new Error(`Submission ${id} not found`);

    return {
      ...this.mapToDomain(s),
      events: s.statusEvents.map((e) => this.mapStatusEventToDomain(e)),
      artifacts: s.artifacts as any[],
    };
  }

  private mapToDomain(s: any): Submission {
    return {
      id: s.id,
      submissionKey: s.submissionKey,
      projectId: s.projectId,
      organisationId: s.organisationId,
      requirementCaseId: s.requirementCaseId,
      domain: s.domain,
      authorityName: s.authorityName,
      authorityType: s.authorityType,
      recipientCode: s.recipientCode,
      recipientChannel: s.recipientChannel as SubmissionChannel,
      status: s.status as SubmissionStatus,
      externalReference: s.externalReference,
      caseNumber: s.caseNumber,
      submittedBy: s.submittedBy,
      submittedAt: s.submittedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  private mapStatusEventToDomain(e: any): SubmissionStatusEvent {
    return {
      id: e.id,
      submissionId: e.submissionId,
      status: e.status as SubmissionStatus,
      sourceSystem: e.sourceSystem,
      summary: e.summary,
      externalReference: e.externalReference,
      occurredAt: e.occurredAt,
    };
  }
}
