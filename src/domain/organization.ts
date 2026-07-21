/**
 * ORGANIZATION DOMAIN
 * Representerar en organisation (kund, myndighet, etc.) i systemet.
 */

export enum OrganizationRole {
  CLIENT = 'CLIENT',
  AUTHORITY = 'AUTHORITY',
  CONTRACTOR = 'CONTRACTOR',
  PARTNER = 'PARTNER',
}

export interface Organization {
  id: string;
  name: string;
  organizationNumber?: string; // Organisationsnummer
  role: OrganizationRole;
  contactEmail?: string;
  phone?: string;
  address?: {
    street: string;
    zipCode: string;
    city: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
