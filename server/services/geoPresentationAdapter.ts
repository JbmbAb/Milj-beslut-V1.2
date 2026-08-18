import type { Feature, FeatureCollection, Geometry } from 'geojson';
import {
  buildWgs84PresentationFeature,
  contentHashToPresentationString,
  type PresentationFeatureInput,
} from './geoPresentationContract';

export type SpatialEvidenceArtifact = {
  readonly artifact_id: string;
  readonly artifact_type: 'SPATIAL_EVIDENCE';
  readonly content_hash: unknown;
  readonly payload: {
    readonly property_ref?: unknown;
    readonly srid: number;
    readonly geometry: Geometry | null;
    readonly layer_ref: {
      readonly layer_id: string;
      readonly layer_version: string;
    };
    readonly source_metadata: {
      readonly provider: string;
      readonly dataset: string;
      readonly dataset_version?: string;
      readonly retrieved_at: string;
    };
  };
};

export class GeoPresentationAdapter {
  async projectEvidenceCollectionToWgs84(
    artifacts: readonly SpatialEvidenceArtifact[],
  ): Promise<FeatureCollection> {
    const features = await Promise.all(artifacts.map((artifact) => this.projectEvidenceToWgs84(artifact)));
    return {
      type: 'FeatureCollection',
      features,
      meta: {
        presentation: 'cesium-l0-l1',
        srid: 4326,
        governance_status: 'VERIFIED_OBSERVATION',
        feature_count: features.length,
      },
    } as FeatureCollection;
  }

  async projectEvidenceToWgs84(artifact: SpatialEvidenceArtifact): Promise<Feature> {
    if (artifact.artifact_type !== 'SPATIAL_EVIDENCE') {
      throw new Error(`Unsupported artifact_type for Cesium presentation: ${artifact.artifact_type}`);
    }
    if (!artifact.payload.geometry) {
      throw new Error(`SpatialEvidenceArtifact ${artifact.artifact_id} has no geometry`);
    }
    if (artifact.payload.srid !== 4326) {
      throw new Error(
        `Cesium presentation requires WGS84 geometry (srid 4326). Got ${artifact.payload.srid} for ${artifact.artifact_id}`,
      );
    }

    const layerVersion =
      artifact.payload.layer_ref.layer_version ||
      artifact.payload.source_metadata.dataset_version ||
      'unknown';

    const input: PresentationFeatureInput = {
      artifact_id: artifact.artifact_id,
      content_hash: contentHashToPresentationString(artifact.content_hash),
      layer_id: artifact.payload.layer_ref.layer_id,
      layer_version: layerVersion,
      provider: artifact.payload.source_metadata.provider,
      dataset: artifact.payload.source_metadata.dataset,
      retrieved_at: artifact.payload.source_metadata.retrieved_at,
      geometry: artifact.payload.geometry,
    };

    return buildWgs84PresentationFeature(input);
  }
}
