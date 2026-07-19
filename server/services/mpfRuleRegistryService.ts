import { prisma } from '../db/prisma';
import type { MpfThreshold, MpfCodeType, MpfPermitClass } from '../../services/mpfEngine';
import { listMpfThresholds } from '../../services/mpfEngine';

/**
 * Registry service for MPF Rules.
 * Supports a "Hybrid" approach: Fetches from DB if available, falls back to static code.
 */
export async function getEffectiveMpfThresholds(): Promise<MpfThreshold[]> {
  try {
    const dbRules = await prisma.mpfRule.findMany();
    
    if (dbRules.length > 0) {
      return dbRules.map(r => ({
        code: r.code,
        codeType: r.codeType as MpfCodeType,
        description: r.description,
        permitClass: r.permitClass as MpfPermitClass,
        thresholdValue: r.thresholdValue,
        sensitiveThresholdValue: r.sensitiveThresholdValue ?? undefined,
        sensitivePermitClass: (r.sensitivePermitClass as MpfPermitClass) ?? undefined,
        thresholdUnit: r.thresholdUnit,
        mpfReference: r.mpfReference,
        requiresEnvironmentalImpactAssessment: r.requiresEia
      }));
    }
  } catch (err) {
    console.warn('MPF Rule Registry: Failed to fetch from DB, falling back to static rules', err);
  }

  // Fallback to the static hardcoded rules in the engine
  return [...listMpfThresholds()];
}

export async function upsertMpfRule(rule: Partial<MpfThreshold>): Promise<void> {
  if (!rule.code || !rule.codeType) throw new Error('Code and CodeType are required');

  await prisma.mpfRule.upsert({
    where: { code: rule.code },
    update: {
      description: rule.description,
      permitClass: rule.permitClass,
      thresholdValue: rule.thresholdValue,
      sensitiveThresholdValue: rule.sensitiveThresholdValue,
      sensitivePermitClass: rule.sensitivePermitClass,
      thresholdUnit: rule.thresholdUnit,
      mpfReference: rule.mpfReference,
      requiresEia: rule.requiresEnvironmentalImpactAssessment,
    },
    create: {
      code: rule.code,
      codeType: rule.codeType,
      description: rule.description || '',
      permitClass: rule.permitClass || 'U',
      thresholdValue: rule.thresholdValue || 0,
      sensitiveThresholdValue: rule.sensitiveThresholdValue,
      sensitivePermitClass: rule.sensitivePermitClass,
      thresholdUnit: rule.thresholdUnit || 'ton/år',
      mpfReference: rule.mpfReference || 'MPF',
      requiresEia: rule.requiresEnvironmentalImpactAssessment || false,
    }
  });
}
