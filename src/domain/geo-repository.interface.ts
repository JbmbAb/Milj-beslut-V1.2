import { GeoAssessment, PropertyInfo, MunicipalityInfo } from './geo';

export interface IGeoRepository {
  findByProject(projectId: string): Promise<GeoAssessment[]>;
  save(assessment: GeoAssessment): Promise<GeoAssessment>;
}

export interface IGeoProvider {
  fetchPropertyInfo(designation: string): Promise<PropertyInfo | null>;
  searchMunicipality(name: string): Promise<MunicipalityInfo | null>;
  assessRisk(coords: { lat: number; lng: number }): Promise<GeoAssessment[]>;
}
