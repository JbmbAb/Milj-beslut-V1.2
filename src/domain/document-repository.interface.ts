import { Document } from './document';

export interface IDocumentRepository {
  findById(id: string): Promise<Document | null>;
  findByProject(projectId: string): Promise<Document[]>;
  save(document: Document): Promise<Document>;
  delete(id: string): Promise<void>;
}
