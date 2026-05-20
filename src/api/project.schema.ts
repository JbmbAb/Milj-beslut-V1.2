import { z } from 'zod';
import { ProjectType } from '../domain/project';

export const CreateProjectSchema = z.object({
  name: z.string().min(3, 'Projektnamn måste vara minst 3 tecken'),
  description: z.string().optional().default(''),
  type: z.nativeEnum(ProjectType),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string(),
    propertyId: z.string(),
    municipality: z.string(),
  }),
  organisationId: z.string().uuid('Ogiltigt organisations-ID'),
});

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

export const ProjectResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  status: z.string(),
  type: z.nativeEnum(ProjectType),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string(),
    propertyId: z.string(),
    municipality: z.string(),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});
