import { z } from 'zod';
import { DocumentCategory } from '../domain/document';
import { IDocumentRepository } from '../domain/document-repository.interface';
import { IAuditRepository } from '../domain/audit-repository.interface';
import { RegisterDocumentUseCase } from '../application/register-document.usecase';

export const RegisterDocumentSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(2),
  fileName: z.string(),
  sizeBytes: z.number().positive(),
  category: z.nativeEnum(DocumentCategory),
  storagePath: z.string(),
  checksum: z.string(),
});

export class DocumentController {
  private registerUseCase: RegisterDocumentUseCase;

  constructor(documentRepo: IDocumentRepository, auditRepo: IAuditRepository) {
    this.registerUseCase = new RegisterDocumentUseCase(documentRepo, auditRepo);
  }

  async register(data: unknown, userId: string) {
    const validated = RegisterDocumentSchema.parse(data);
    return await this.registerUseCase.execute({
      projectId: validated.projectId,
      name: validated.name,
      fileName: validated.fileName,
      sizeBytes: validated.sizeBytes,
      category: validated.category,
      storagePath: validated.storagePath,
      checksum: validated.checksum,
      userId,
    });
  }
}
