import { z } from 'zod';

/**
 * requirementsModel.ts
 *
 * Stabilisera requirement-modellen i kod (runtime-validering) så att:
 * - AI-utdata kan valideras/normaliseras deterministiskt
 * - migrering kan ske utan att "lösa" JSON-strukturer flyter runt
 */

export const requirementLevelSchema = z.enum(['mandatory', 'recommended', 'conditional']);

export const requirementExtractedSchema = z.object({
  documentId: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  /** Exakt textcitat som ligger till grund för tolkningen. */
  requirementTextQuote: z.string().min(1),
  /** Professionell tolkning som kan granskas. */
  interpretedRequirement: z.string().min(1),
  level: requirementLevelSchema,
  legalReference: z.string().min(1).nullable().optional(),
});

export type RequirementExtracted = z.infer<typeof requirementExtractedSchema>;

export function parseExtractedRequirementsJson(raw: string): RequirementExtracted[] {
  const parsed = JSON.parse(raw);
  const arraySchema = z.array(requirementExtractedSchema);
  return arraySchema.parse(parsed);
}
