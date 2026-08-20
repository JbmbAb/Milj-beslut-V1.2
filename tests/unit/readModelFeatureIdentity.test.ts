import { describe, expect, it } from 'vitest';
import {
  createDerivedFeatureIdentity,
  createSourceFeatureIdentity,
  READ_MODEL_LAYER_ID,
} from '../../server/modules/gis/readModelFeatureIdentity';

describe('ReadModelFeatureIdentityV1', () => {
  it('keeps a source feature reference stable across reloads', () => {
    const before = createSourceFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROTECTED_AREA,
      sourceNamespace: 'NVR',
      sourceFeatureId: '123',
    });
    const after = createSourceFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROTECTED_AREA,
      sourceNamespace: 'NVR',
      sourceFeatureId: '123',
    });

    expect(after).toEqual(before);
  });

  it('namespaces equal local ids into distinct feature references', () => {
    const nvr = createSourceFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROTECTED_AREA,
      sourceNamespace: 'NVR',
      sourceFeatureId: '123',
    });
    const natura2000 = createSourceFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROTECTED_AREA,
      sourceNamespace: 'Natura2000',
      sourceFeatureId: '123',
    });

    expect(nvr.feature_ref).not.toBe(natura2000.feature_ref);
  });

  it('derives a merged property reference from its complete source component set', () => {
    const first = createDerivedFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROPERTY,
      recipeVersion: 'property-merge-v1',
      sourceComponents: ['lm:2', 'lm:1'],
    });
    const reorderedReload = createDerivedFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROPERTY,
      recipeVersion: 'property-merge-v1',
      sourceComponents: ['lm:1', 'lm:2'],
    });
    const changedInputs = createDerivedFeatureIdentity({
      layerId: READ_MODEL_LAYER_ID.PROPERTY,
      recipeVersion: 'property-merge-v1',
      sourceComponents: ['lm:1', 'lm:3'],
    });

    expect(reorderedReload).toEqual(first);
    expect(changedInputs.feature_ref).not.toBe(first.feature_ref);
  });

  it('rejects empty source identity components instead of falling back to a database id', () => {
    expect(() =>
      createSourceFeatureIdentity({
        layerId: READ_MODEL_LAYER_ID.TOPO10_BUILDING,
        sourceNamespace: 'topo10.byggnad',
        sourceFeatureId: '',
      }),
    ).toThrow('READ_MODEL_FEATURE_IDENTITY_INVALID:source_feature_id');
  });
});
