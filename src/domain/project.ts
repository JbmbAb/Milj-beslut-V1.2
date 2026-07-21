/**
 * PROJECT DOMAIN
 * Hjärtat i verksamheten. Representerar ett miljöprojekt eller tillståndsärende.
 */

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  COMPLETED = 'COMPLETED',
}

export enum ProjectType {
  ENV_PERMIT = 'ENV_PERMIT',
  REMEDIATION = 'REMEDIATION',
  INFRA = 'INFRA',
  ENERGY = 'ENERGY',
  VA = 'VA',
}

export interface ProjectLocation {
  lat: number;
  lng: number;
  address: string;
  propertyId: string; // Fastighetsbeteckning
  municipality: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  type: ProjectType;
  location: ProjectLocation;
  organisationId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}
