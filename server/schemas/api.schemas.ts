import { z } from 'zod';

// ─── Shared ──────────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.string().optional().transform((v) => Math.max(1, parseInt(v ?? '1', 10))),
  limit: z.string().optional().transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '10', 10)))),
});

// ─── Auth ────────────────────────────────────────────────────────────────────

export const adminLoginSchema = z.object({
  username: z.string().min(1, 'Username is required').trim(),
  password: z.string().min(1, 'Password is required'),
});

// ─── Projects ────────────────────────────────────────────────────────────────

export const createProjectSchema = z.object({
  propertyDesignation: z.string().min(1, 'Fastighetsbeteckning krävs').trim().toUpperCase(),
  organisationId: z.string().uuid().optional(),
});

export const projectPlanSchema = z.object({
  description: z.string().optional(),
  estimatedDurationDays: z.number().int().min(0).optional(),
  templateId: z.string().optional(),
  sections: z.array(z.any()).optional(),
});

export const carbonInputSchema = z.object({
  tons: z.number().min(0),
  distanceKm: z.number().min(0).optional(),
  manualDistanceKm: z.number().min(0).optional(),
  transportMode: z.enum(['TRUCK', 'RAIL', 'SHIP']),
  materialType: z.enum(['SOIL', 'ROCK', 'WASTE', 'MIXED']),
  emissionFactorKgCo2ePerTonKm: z.number().min(0).optional(),
});

// ─── Sewage ──────────────────────────────────────────────────────────────────

export const sewageApplicationSchema = z.object({
  propertyAddress: z.string().min(1, 'Adress krävs').trim(),
  householdSize: z.number().int().min(1).max(50),
  latitude: z.number(),
  longitude: z.number(),
  contactEmail: z.string().email().optional(),
});

// ─── GIS ─────────────────────────────────────────────────────────────────────

export const spatialAuditSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radius: z.number().min(0).max(5000).optional().default(100),
});
