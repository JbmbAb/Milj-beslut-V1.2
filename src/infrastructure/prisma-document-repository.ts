import { Prisma } from '@prisma/client';
import { prisma } from '../../db.server';
import { Document, DocumentStatus, DocumentCategory } from '../domain/document';
import { IDocumentRepository } from '../domain/document-repository.interface';

export class PrismaDocumentRepository implements IDocumentRepository {
  async findById(id: string): Promise<Document | null> {
    const doc = await prisma.documentRecord.findUnique({ where: { id } });
    return doc ? this.mapToDomain(doc) : null;
  }

  async findByProject(projectId: string): Promise<Document[]> {
    const docs = await prisma.documentRecord.findMany({ where: { projectId } });
    return docs.map((doc) => this.mapToDomain(doc));
  }

  async save(document: Document): Promise<Document> {
    const updateData: Prisma.DocumentRecordUncheckedUpdateInput = {
      projectId: document.projectId,
      organisationId: 'org-id', // Simplified mapping, needs real orgId
      entryId: document.id,
      originalName: document.name,
      diskName: document.fileName,
      absolutePath: document.storagePath,
      fileSize: BigInt(document.sizeBytes),
      status: 'METADATA_ONLY', // Map from DocumentStatus
      subject: document.name,
    };

    const createData: Prisma.DocumentRecordUncheckedCreateInput = {
      id: document.id,
      projectId: document.projectId,
      organisationId: 'org-id', // Simplified mapping, needs real orgId
      entryId: document.id,
      originalName: document.name,
      diskName: document.fileName,
      absolutePath: document.storagePath,
      fileSize: BigInt(document.sizeBytes),
      status: 'METADATA_ONLY', // Map from DocumentStatus
      subject: document.name,
    };

    const upserted = await prisma.documentRecord.upsert({
      where: { id: document.id },
      update: updateData,
      create: createData,
    });

    return this.mapToDomain(upserted);
  }

  async delete(id: string): Promise<void> {
    await prisma.documentRecord.delete({ where: { id } });
  }

  private mapToDomain(prismaDoc: any): Document {
    return {
      id: prismaDoc.id,
      projectId: prismaDoc.projectId,
      name: prismaDoc.originalName,
      fileName: prismaDoc.diskName,
      mimeType: prismaDoc.mimeType || 'application/octet-stream',
      sizeBytes: Number(prismaDoc.fileSize),
      status: DocumentStatus.ANALYZED,
      category: DocumentCategory.TECHNICAL_REPORT,
      checksum: prismaDoc.fileSha256 || '',
      storagePath: prismaDoc.absolutePath,
      metadata: (prismaDoc.manifestMeta as any) || {},
      uploadedBy: 'SYSTEM',
      uploadedAt: prismaDoc.createdAt,
    };
  }
}
