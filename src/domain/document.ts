/**
 * DOCUMENT DOMAIN
 * Representerar ett inkommet eller genererat dokument i ett projekt.
 */

export enum DocumentStatus {
  RECEIVED = 'RECEIVED',
  PROCESSING = 'PROCESSING',
  ANALYZED = 'ANALYZED',
  ARCHIVED = 'ARCHIVED',
  ERROR = 'ERROR',
}

export enum DocumentCategory {
  PERMIT_DECISION = 'PERMIT_DECISION', // Beslut
  TECHNICAL_REPORT = 'TECHNICAL_REPORT', // Teknisk rapport
  MAP = 'MAP', // Karta
  COMMUNICATION = 'COMMUNICATION', // Myndighetskommunikation
  APPLICATION = 'APPLICATION', // Ansökan
}

export interface Document {
  id: string;
  projectId: string;
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  category: DocumentCategory;
  checksum: string; // För integritet (sha256)
  storagePath: string; // Referens till adapterlagret
  metadata: Record<string, any>;
  uploadedBy: string;
  uploadedAt: Date;
}
