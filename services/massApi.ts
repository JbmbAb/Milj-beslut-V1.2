import { callCore } from './coreApiClient';
import type { MassGisAnalysisRequest, MassGisAnalysisResponse } from '../types';

export async function analyzeMassSite(params: MassGisAnalysisRequest): Promise<MassGisAnalysisResponse> {
  const result = await callCore<{
    ok: boolean;
    analysis: MassGisAnalysisResponse['analysis'];
    siteProfile: MassGisAnalysisResponse['siteProfile'];
    propertySource: string;
  }>('/api/c-notification/mass/gis-analysis', { body: params });

  return {
    analysis: result.analysis,
    siteProfile: result.siteProfile,
    propertySource: result.propertySource,
  };
}
