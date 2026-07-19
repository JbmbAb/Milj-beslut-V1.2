declare module 'leaflet.vectorgrid' {
  import type * as L from 'leaflet';

  type VectorTileFeatureProperties = Record<string, string | number | boolean | null | undefined>;

  type VectorTileLayerStyles =
    | L.PathOptions
    | ((properties: VectorTileFeatureProperties, zoom: number) => L.PathOptions);

  type ProtobufOptions = {
    interactive?: boolean;
    getFeatureId?: (feature: { properties: VectorTileFeatureProperties }) => string | number | undefined;
    vectorTileLayerStyles?: Record<string, VectorTileLayerStyles>;
  };

  const vectorGrid: {
    protobuf(url: string, options?: ProtobufOptions): L.Layer;
  };

  export { vectorGrid };
}
