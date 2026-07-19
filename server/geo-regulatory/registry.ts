import { GEO_REGULATORY_DOMAIN_PACKS } from './catalog';
import type { GeoRegulatoryAssessmentRequest, GeoRegulatoryDomainId, GeoRegulatoryRulePack } from './types';

const RULE_PACKS_BY_ID = new Map<string, GeoRegulatoryRulePack>(
  GEO_REGULATORY_DOMAIN_PACKS.map((pack) => [pack.id, pack]),
);

const RULE_PACKS_BY_DOMAIN = new Map<GeoRegulatoryDomainId, GeoRegulatoryRulePack[]>();

for (const pack of GEO_REGULATORY_DOMAIN_PACKS) {
  const existing = RULE_PACKS_BY_DOMAIN.get(pack.domain) || [];
  existing.push(pack);
  RULE_PACKS_BY_DOMAIN.set(pack.domain, existing);
}

export function getGeoRegulatoryRulePack(packId: string): GeoRegulatoryRulePack | undefined {
  return RULE_PACKS_BY_ID.get(packId);
}

export function listGeoRegulatoryRulePacks(domain?: GeoRegulatoryDomainId): GeoRegulatoryRulePack[] {
  if (!domain) {
    return GEO_REGULATORY_DOMAIN_PACKS.slice();
  }
  return (RULE_PACKS_BY_DOMAIN.get(domain) || []).slice();
}

export function resolvePrimaryRulePack(domain: GeoRegulatoryDomainId): GeoRegulatoryRulePack | undefined {
  const packs = RULE_PACKS_BY_DOMAIN.get(domain) || [];
  return packs[0];
}

export function collectRequiredReviewGates(request: GeoRegulatoryAssessmentRequest): string[] {
  const pack = resolvePrimaryRulePack(request.domain);
  if (!pack) {
    return [];
  }
  return pack.reviewGates.map((gate) => gate.id);
}
