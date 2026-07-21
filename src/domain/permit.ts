/**
 * PERMIT CASE DOMAIN
 * Representerar ett myndighetsärende eller ett specifikt tillstånd.
 */

export enum DecisionType {
  BIFALL = 'BIFALL',
  AVSLAG = 'AVSLAG',
  UNKNOWN = 'OKÄNT',
}

export interface PermitCase {
  id: string;
  projectId: string;
  caseNumber?: string; // Myndighetens diarienummer
  authorityName: string; // T.ex. "Länsstyrelsen" eller "Miljönämnden"
  decisionType: DecisionType;
  decisionDate?: Date;
  validFrom?: Date;
  validTo?: Date;
  municipality: string;
  wasteCodes?: string[]; // EWC/SNI-koder kopplade till tillståndet
  fullText?: string; // Extraherad text från beslutet
  createdAt: Date;
  updatedAt: Date;
}
