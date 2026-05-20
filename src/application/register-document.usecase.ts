import { Document, DocumentStatus, DocumentCategory } from '../domain/document';
import { IDocumentRepository } from '../domain/document-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { AuditAction } from '../domain/audit';
import { randomUUID } from 'node:crypto';

export interface RegisterDocumentInput {
  projectId: string;
  name: string;
  fileName: string;
  sizeBytes: number;
  category: DocumentCategory;
  storagePath: string;
  checksum: string;
  userId: string;
}

export class RegisterDocumentUseCase {
  constructor(
    private documentRepo: IDocumentRepository,
    private auditRepo: IAuditRepository,
  ) {}

  async execute(input: RegisterDocumentInput): Promise<Document> {
    const document: Document = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      fileName: input.fileName,
      mimeType: 'application/pdf', // Default för denna domän
      sizeBytes: input.sizeBytes,
      status: DocumentStatus.RECEIVED,
      category: input.category,
      checksum: input.checksum,
      storagePath: input.storagePath,
      metadata: {},
      uploadedBy: input.userId,
      uploadedAt: new Date(),
    };

    const savedDoc = await this.documentRepo.save(document);

    await this.auditRepo.save({
      id: randomUUID(),
      timestamp: new Date(),
      userId: input.userId,
      action: AuditAction.UPDATE,
      entityType: 'Document',
      entityId: savedDoc.id,
      details: `Document "${savedDoc.name}" registered in project ${input.projectId}`,
    });

    return savedDoc;
  }
}
