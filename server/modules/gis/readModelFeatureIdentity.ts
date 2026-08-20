import { createHash } from 'node:crypto';

export const READ_MODEL_FEATURE_IDENTITY_VERSION = 'read-model-feature-identity-v1' as const;

export type ReadModelFeatureIdentityKind = 'SOURCE' | 'DERIVED';

export interface ReadModelFeatureIdentityV1 {
  readonly layer_id: string;
  readonly identity_kind: ReadModelFeatureIdentityKind;
  readonly identity_version: typeof READ_MODEL_FEATURE_IDENTITY_VERSION;
  readonly source_namespace?: string;
  readonly source_feature_id?: string;
  readonly derived_feature_id?: string;
  readonly feature_ref: string;
}

export const READ_MODEL_LAYER_ID = {
  PROPERTY: 'property',
  TOPO10_BUILDING: 'topo10-building',
  PROTECTED_AREA: 'protected-area',
} as const;

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`READ_MODEL_FEATURE_IDENTITY_INVALID:${field}`);
  }
  return normalized;
}

function refPart(value: string): string {
  return encodeURIComponent(value);
}

export function createSourceFeatureIdentity(input: {
  layerId: string;
  sourceNamespace: string;
  sourceFeatureId: string;
}): ReadModelFeatureIdentityV1 {
  const layerId = requiredText(input.layerId, 'layer_id');
  const sourceNamespace = requiredText(input.sourceNamespace, 'source_namespace');
  const sourceFeatureId = requiredText(input.sourceFeatureId, 'source_feature_id');

  return {
    layer_id: layerId,
    identity_kind: 'SOURCE',
    identity_version: READ_MODEL_FEATURE_IDENTITY_VERSION,
    source_namespace: sourceNamespace,
    source_feature_id: sourceFeatureId,
    feature_ref: `rmf:v1:source:${refPart(layerId)}:${refPart(sourceNamespace)}:${refPart(sourceFeatureId)}`,
  };
}

/**
 * A derived id is only valid when every source component is known. The sorted
 * component set makes row order and import order irrelevant to its identity.
 */
export function createDerivedFeatureIdentity(input: {
  layerId: string;
  recipeVersion: string;
  sourceComponents: readonly string[];
}): ReadModelFeatureIdentityV1 {
  const layerId = requiredText(input.layerId, 'layer_id');
  const recipeVersion = requiredText(input.recipeVersion, 'recipe_version');
  const sourceComponents = [...new Set(input.sourceComponents.map((value) => requiredText(value, 'source_component')))].sort();
  if (sourceComponents.length === 0) {
    throw new Error('READ_MODEL_FEATURE_IDENTITY_INVALID:source_components');
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ layer_id: layerId, recipe_version: recipeVersion, source_components: sourceComponents }))
    .digest('hex');
  const derivedFeatureId = `sha256:${digest}`;

  return {
    layer_id: layerId,
    identity_kind: 'DERIVED',
    identity_version: READ_MODEL_FEATURE_IDENTITY_VERSION,
    derived_feature_id: derivedFeatureId,
    feature_ref: `rmf:v1:derived:${refPart(layerId)}:${refPart(recipeVersion)}:${derivedFeatureId}`,
  };
}
