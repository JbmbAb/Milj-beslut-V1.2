import { apiClient } from './apiClient';
import { callCore } from './coreApiClient';
import type {
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageRequirement,
  SewageSystemTypeId,
} from '../types';

export interface SewageRequirementChecklistRequest {
  systemType: SewageSystemTypeId;
  protectionLevel: 'NORMAL' | 'HIGH';
  municipalityCode: string;
  distanceData?: {
    toWell?: number;
    toPropertyLine?: number;
    toWaterCourse?: number;
    toNeighborWell?: number;
  };
}

export interface SewageAnalysisRequest {
  propertyDesignation: string;
  municipalityCode: string;
  latitude: number;
  longitude: number;
  pe: number;
}

export async function fetchSewageRequirementChecklist(
  params: SewageRequirementChecklistRequest,
): Promise<SewageRequirement[]> {
  const result = await callCore<{ ok: boolean; requirements: SewageRequirement[] }>(
    '/api/sewage/requirement-checklist',
    { body: params },
  );
  return result.requirements;
}

export async function analyzeSewageProperty(params: SewageAnalysisRequest): Promise<{
  analysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
}> {
  const result = await callCore<{
    ok: boolean;
    analysis: SewageGISAnalysis;
    protectionProfile: SewageProtectionProfile;
  }>('/api/sewage/analyze', { body: params });

  return {
    analysis: result.analysis,
    protectionProfile: result.protectionProfile,
  };
}

export async function queryMarkCoverAtPoint(lat: number, lng: number): Promise<{
  value: number;
  description: string;
}> {
  return apiClient.post('/api/layers/marktacke/query', { lat, lng });
}

export async function runWaterAuditAtPoint(lat: number, lng: number): Promise<unknown> {
  return apiClient.post('/api/hydro/water-audit', { lat, lng });
}
