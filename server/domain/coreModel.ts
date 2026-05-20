import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * coreModel.ts (FROZEN CONTRACT)
 *
 * Detta är den versionsstyrda kärnmodellen som ska hållas stabil under migrering.
 * Vi gör den "signerad" genom att publicera ett deterministiskt schema-hash-manifest
 * som används av readiness gate och tester.
 */

export const CORE_MODEL_VERSION = 1 as const;

export const idSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().datetime({ offset: true }).or(z.string().datetime());

export const projectStatusSchema = z.enum(['OPEN', 'CLOSED', 'ARCHIVED']);

export const projectSchema = z.object({
  id: idSchema,
  organisationId: idSchema,
  propertyDesignation: z.string().min(1),
  status: projectStatusSchema,
  createdAt: isoDateTimeSchema,
  closedAt: isoDateTimeSchema.nullable().optional(),
});
export type ProjectCore = z.infer<typeof projectSchema>;

// PermitCase: minsta stable “tillståndscase” kopplat till projekt + typ + status.
export const permitCaseStatusSchema = z.enum([
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED_FOR_SUBMISSION',
  'SUBMITTED',
  'DECIDED',
  'CANCELLED',
]);

export const permitCaseSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  organisationId: idSchema,
  permitType: z.string().min(1),
  status: permitCaseStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PermitCaseCore = z.infer<typeof permitCaseSchema>;

export const documentProcessingStatusSchema = z.enum([
  'METADATA_ONLY',
  'TEXT_EXTRACTED',
  'INDEXED',
  'FAILED',
]);

export const documentSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  organisationId: idSchema,
  originalName: z.string().min(1),
  diskName: z.string().min(1),
  mimeType: z.string().min(1).nullable().optional(),
  fileSha256: z.string().min(16).nullable().optional(),
  status: documentProcessingStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type DocumentCore = z.infer<typeof documentSchema>;

// Requirement: fryst livscykel + source-of-truth-fält.
export const requirementSourceSchema = z.enum(['AI_EXTRACTED', 'AUTHORITY', 'GIS_RULE', 'MANUAL']);
export const requirementStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'CLOSED',
]);

export const requirementSchema = z.object({
  id: idSchema,
  requirementCode: z.string().min(1),
  projectId: idSchema,
  documentId: idSchema,
  caseId: idSchema,
  sourceType: requirementSourceSchema,
  status: requirementStatusSchema,
  // Source of truth: quote + interpretedRequirement + citations
  requirementTextQuote: z.string().min(1),
  interpretedRequirement: z.string().min(1),
  legalReference: z.string().nullable().optional(),
  // AI vs system fields
  aiGenerated: z.boolean(),
  systemLocked: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().min(1),
});
export type RequirementCore = z.infer<typeof requirementSchema>;

export const submissionStatusSchema = z.enum(['CREATED', 'SENT', 'ACKED', 'FAILED', 'CANCELLED']);

export const submissionSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  organisationId: idSchema,
  permitCaseId: idSchema.nullable().optional(),
  authority: z.string().min(1),
  status: submissionStatusSchema,
  createdAt: isoDateTimeSchema,
});
export type SubmissionCore = z.infer<typeof submissionSchema>;

export const auditEventTypeSchema = z.enum([
  'AI_DRAFT_GENERATED',
  'AI_REQUIREMENTS_EXTRACTED',
  'REQUIREMENT_STATUS_CHANGED',
  'REQUIREMENT_UPDATED',
  'SUBMISSION_CREATED',
  'SUBMISSION_SENT',
  'SIGNATURE_APPLIED',
  'GIS_LAYER_QUERIED',
]);

export const auditEventSchema = z.object({
  id: idSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: auditEventTypeSchema,
  userId: idSchema.nullable().optional(),
  timestamp: isoDateTimeSchema,
  payloadHash: z.string().min(16),
  prevHash: z.string().nullable().optional(),
  chainHash: z.string().min(16),
  modelVersion: z.literal(CORE_MODEL_VERSION),
});
export type AuditEventCore = z.infer<typeof auditEventSchema>;

function stableJson(obj: unknown): string {
  // Minimal stabil json (sort keys recursively for hashing)
  const sorter = (value: any): any => {
    if (Array.isArray(value)) return value.map(sorter);
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((acc: any, k) => {
          acc[k] = sorter(value[k]);
          return acc;
        }, {});
    }
    return value;
  };
  return JSON.stringify(sorter(obj));
}

export function schemaHash(schema: z.ZodTypeAny): string {
  // Use Zod's internal shape via toJSON if available; fallback to string.
  const anySchema = schema as any;
  const json =
    typeof anySchema.toJSON === 'function' ? anySchema.toJSON() : String(anySchema?._def?.typeName ?? '');
  return crypto.createHash('sha256').update(stableJson(json)).digest('hex');
}

export const CORE_MODEL_MANIFEST = {
  version: CORE_MODEL_VERSION,
  project: schemaHash(projectSchema),
  permitCase: schemaHash(permitCaseSchema),
  document: schemaHash(documentSchema),
  requirement: schemaHash(requirementSchema),
  submission: schemaHash(submissionSchema),
  auditEvent: schemaHash(auditEventSchema),
} as const;
