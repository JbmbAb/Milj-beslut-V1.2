import { z } from 'zod';

export const traceIdSchema = z.object({
  traceId: z.string().min(1),
});

export const classificationRequestSchema = z.object({
  activity_code: z.string().trim().min(1),
  ewc_code: z.string().trim().min(1).optional().default(''),
  volume_tons: z.coerce.number().finite().nonnegative(),
});

export const classificationResponseSchema = traceIdSchema.extend({
  classification: z.string().min(1),
  legal_basis: z.string().min(1),
  status: z.enum(['MATCHED', 'FALLBACK']),
  ewc_code: z.string().optional(),
  volume_tons: z.number().finite().nonnegative(),
});

export const requirementItemSchema = z.object({
  rule: z.string().min(1),
  law: z.string().min(1),
  citation: z.string().min(1),
});

export const complianceRequirementsRequestSchema = z.object({
  activity_code: z.string().trim().min(1),
  ewc_code: z.string().trim().min(1).optional().default(''),
});

export const complianceRequirementsResponseSchema = traceIdSchema.extend({
  requirements: z.array(requirementItemSchema),
  source: z.enum(['INDEX', 'AI', 'FALLBACK']),
});

export const riskAnalysisRequestSchema = z.object({
  ewc_code: z.string().trim().min(1),
  volume_tons: z.coerce.number().finite().nonnegative(),
  location: z.string().trim().optional().default(''),
});

export const riskAnalysisResponseSchema = traceIdSchema.extend({
  risk_flags: z.array(z.string().min(1)),
  risk_score: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
});

export const labSampleSchema = z.object({
  parameter: z.string().trim().min(1),
  value: z.coerce.number().finite(),
  unit: z.string().trim().optional(),
});

export const labValidateRequestSchema = z.object({
  sample_results: z.array(labSampleSchema).min(1),
});

export const exceedanceSchema = z.object({
  parameter: z.string().min(1),
  value: z.number().finite(),
  limit: z.number().finite(),
  unit: z.string().optional(),
});

export const labValidateResponseSchema = traceIdSchema.extend({
  status: z.enum(['PASS', 'FAIL']),
  exceedances: z.array(exceedanceSchema),
});

export const permitGenerateRequestSchema = z.object({
  project_data: z.record(z.unknown()).default({}),
  requirements: z.array(requirementItemSchema).default([]),
  risk_flags: z.array(z.string()).default([]),
});

export const permitGenerateResponseSchema = traceIdSchema.extend({
  document_type: z.string().min(1),
  draft_text: z.string().min(1),
});

export const verificationCheckRequestSchema = z.object({
  analysis: z.unknown(),
});

export const verificationCheckResponseSchema = traceIdSchema.extend({
  status: z.enum(['VERIFIED', 'UNVERIFIED']),
  missing_citations: z.array(z.string()),
});

export const documentExportRequestSchema = z.object({
  draft_text: z.string().trim().min(1),
  document_type: z.string().trim().min(1),
});

export const mvpWorkflowRequestSchema = z.object({
  activity_code: z.string().trim().min(1),
  ewc_code: z.string().trim().min(1),
  volume_tons: z.coerce.number().finite().nonnegative(),
  location: z.string().trim().optional().default(''),
  project_data: z.record(z.unknown()).default({}),
});

export const mvpWorkflowResponseSchema = traceIdSchema.extend({
  classification: classificationResponseSchema.omit({ traceId: true }),
  requirements: complianceRequirementsResponseSchema.omit({ traceId: true }),
  risk: riskAnalysisResponseSchema.omit({ traceId: true }),
  permit: permitGenerateResponseSchema.omit({ traceId: true }),
  verification: verificationCheckResponseSchema.omit({ traceId: true }),
});

export type ClassificationRequest = z.infer<typeof classificationRequestSchema>;
export type ClassificationResponse = z.infer<typeof classificationResponseSchema>;
export type RequirementItem = z.infer<typeof requirementItemSchema>;
export type ComplianceRequirementsRequest = z.infer<typeof complianceRequirementsRequestSchema>;
export type ComplianceRequirementsResponse = z.infer<typeof complianceRequirementsResponseSchema>;
export type RiskAnalysisRequest = z.infer<typeof riskAnalysisRequestSchema>;
export type RiskAnalysisResponse = z.infer<typeof riskAnalysisResponseSchema>;
export type LabValidateRequest = z.infer<typeof labValidateRequestSchema>;
export type LabValidateResponse = z.infer<typeof labValidateResponseSchema>;
export type PermitGenerateRequest = z.infer<typeof permitGenerateRequestSchema>;
export type PermitGenerateResponse = z.infer<typeof permitGenerateResponseSchema>;
export type VerificationCheckRequest = z.infer<typeof verificationCheckRequestSchema>;
export type VerificationCheckResponse = z.infer<typeof verificationCheckResponseSchema>;
export type DocumentExportRequest = z.infer<typeof documentExportRequestSchema>;
export type MvpWorkflowRequest = z.infer<typeof mvpWorkflowRequestSchema>;
export type MvpWorkflowResponse = z.infer<typeof mvpWorkflowResponseSchema>;
