import type { GeoRegulatoryCapability, GeoRegulatoryDomainId, GeoRegulatoryRulePack } from './types';

export const GEO_REGULATORY_CORE_CAPABILITIES: GeoRegulatoryCapability[] = [
  'spatial_lookup',
  'regulatory_evaluation',
  'risk_scoring',
  'evidence_bundle',
  'matrix_projection',
  'document_generation',
  'submission_dispatch',
  'feedback_ingestion',
  'postgis_binding',
  'economic_snapshot',
];

export const GEO_REGULATORY_DOMAIN_PACKS: GeoRegulatoryRulePack[] = [
  {
    id: 'core.sewage.v1',
    domain: 'sewage',
    displayName: 'Sewage And Small Wastewater',
    version: '1.0.0',
    status: 'active',
    description: 'Current baseline for sewage and permit-style environmental workflows.',
    requiredCapabilities: [
      'spatial_lookup',
      'regulatory_evaluation',
      'risk_scoring',
      'evidence_bundle',
      'document_generation',
      'submission_dispatch',
      'feedback_ingestion',
    ],
    requiredEvidenceKinds: ['legal_source', 'document', 'postgis_layer', 'municipal_rule'],
    reviewGates: [
      {
        id: 'before_binding_assessment',
        label: 'Review before binding recommendation',
        reason: 'A human must confirm the legal and factual interpretation.',
        requiredRole: 'legal_reviewer',
      },
      {
        id: 'before_official_submission',
        label: 'Review before official submission',
        reason: 'A human must approve the final outbound application package.',
        requiredRole: 'case_handler',
      },
    ],
    outputs: [
      { kind: 'assessment', label: 'Assessment', description: 'Structured permit assessment.' },
      { kind: 'document_draft', label: 'Document draft', description: 'Draft application package.' },
      {
        kind: 'submission_package',
        label: 'Submission package',
        description: 'Authority or municipality ready outbound envelope.',
      },
    ],
  },
  {
    id: 'core.shoreline-protection.v1',
    domain: 'shoreline_protection',
    displayName: 'Shoreline Protection',
    version: '1.0.0',
    status: 'planned',
    description: 'Distance, protection zone and nature-value focused shoreline assessments.',
    requiredCapabilities: [
      'spatial_lookup',
      'regulatory_evaluation',
      'risk_scoring',
      'evidence_bundle',
      'matrix_projection',
    ],
    requiredEvidenceKinds: ['legal_source', 'judgment', 'postgis_layer', 'municipal_rule'],
    reviewGates: [
      {
        id: 'before_binding_assessment',
        label: 'Legal shoreline review',
        reason: 'Dispensation advice must be reviewed before it is treated as binding.',
        requiredRole: 'legal_reviewer',
      },
    ],
    outputs: [
      { kind: 'assessment', label: 'Assessment', description: 'Dispensation-oriented assessment.' },
      { kind: 'risk_flags', label: 'Risk flags', description: 'Spatial and legal warning flags.' },
    ],
  },
  {
    id: 'core.building-permit.v1',
    domain: 'building_permit',
    displayName: 'Building Permit And Advance Notice',
    version: '1.0.0',
    status: 'planned',
    description: 'Buildability, plan status, restriction zones and completeness checks.',
    requiredCapabilities: [
      'spatial_lookup',
      'regulatory_evaluation',
      'risk_scoring',
      'evidence_bundle',
      'document_generation',
      'submission_dispatch',
    ],
    requiredEvidenceKinds: ['legal_source', 'document', 'postgis_layer', 'municipal_rule'],
    reviewGates: [
      {
        id: 'before_binding_assessment',
        label: 'Planning review',
        reason: 'Planning interpretation must be checked before user-facing conclusion.',
        requiredRole: 'case_handler',
      },
      {
        id: 'before_official_submission',
        label: 'Submission review',
        reason: 'Permit applications need explicit approval before dispatch.',
        requiredRole: 'case_handler',
      },
    ],
    outputs: [
      { kind: 'assessment', label: 'Assessment', description: 'Buildable or not buildable assessment.' },
      { kind: 'requirements', label: 'Requirements', description: 'Completeness and risk checklist.' },
      { kind: 'document_draft', label: 'Document draft', description: 'Draft permit request.' },
    ],
  },
  {
    id: 'core.stormwater-lod.v1',
    domain: 'stormwater_lod',
    displayName: 'Stormwater And LOD',
    version: '1.0.0',
    status: 'planned',
    description: 'Hydrology-oriented site suitability and mitigation design support.',
    requiredCapabilities: [
      'spatial_lookup',
      'regulatory_evaluation',
      'risk_scoring',
      'evidence_bundle',
      'postgis_binding',
      'economic_snapshot',
    ],
    requiredEvidenceKinds: ['legal_source', 'postgis_layer', 'raster', 'economic_assumption'],
    reviewGates: [
      {
        id: 'before_binding_assessment',
        label: 'Hydrology review',
        reason: 'Hydrology outputs must be confirmed before they drive formal recommendation.',
        requiredRole: 'environmental_reviewer',
      },
      {
        id: 'before_economic_commit',
        label: 'Economic review',
        reason: 'Costed mitigation options need a separate approval step.',
        requiredRole: 'financial_reviewer',
      },
    ],
    outputs: [
      { kind: 'assessment', label: 'Assessment', description: 'LOD suitability and flow summary.' },
      { kind: 'risk_flags', label: 'Risk flags', description: 'Flooding and low-point warning flags.' },
      { kind: 'requirements', label: 'Requirements', description: 'Suggested mitigation package.' },
    ],
  },
  {
    id: 'core.mass-handling.v1',
    domain: 'mass_handling',
    displayName: 'Excavation, Fill And Mass Handling',
    version: '1.0.0',
    status: 'planned',
    description: 'Mass classification, routing, water proximity and volume-driven notices.',
    requiredCapabilities: [
      'spatial_lookup',
      'regulatory_evaluation',
      'risk_scoring',
      'evidence_bundle',
      'document_generation',
      'economic_snapshot',
    ],
    requiredEvidenceKinds: ['legal_source', 'document', 'postgis_layer', 'economic_assumption'],
    reviewGates: [
      {
        id: 'before_binding_assessment',
        label: 'Environmental review',
        reason: 'Mass handling classifications need environmental review before use.',
        requiredRole: 'environmental_reviewer',
      },
      {
        id: 'before_official_submission',
        label: 'Notice review',
        reason: 'A human must approve the C-notice package before dispatch.',
        requiredRole: 'case_handler',
      },
    ],
    outputs: [
      { kind: 'assessment', label: 'Assessment', description: 'Notice and routing assessment.' },
      { kind: 'requirements', label: 'Requirements', description: 'Mass handling requirements list.' },
      { kind: 'document_draft', label: 'Document draft', description: 'Draft notice package.' },
    ],
  },
];

export function listGeoRegulatoryDomains(): GeoRegulatoryDomainId[] {
  return GEO_REGULATORY_DOMAIN_PACKS.map((pack) => pack.domain);
}
