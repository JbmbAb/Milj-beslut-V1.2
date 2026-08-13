import {
  createLuRegistryRuntime,
  LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID,
  SpatialProviderResolver,
  type ISpatialProvider,
} from "@miljobeslut/mps-lu";
import { MimersIntegration, type ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { SpatialProviderPostGIS } from "@miljobeslut/spatial-provider-postgis";

export interface LocalizationSpatialRuntime {
  readonly artifactRepository: ArtifactRepositoryPort;
  resolveSpatialProvider(capabilityKey: string): ISpatialProvider;
  wgs84ToSweref99(lat: number, lng: number): Promise<readonly [number, number]>;
  close(): Promise<void>;
}

/**
 * P4A-LU-05 composition root for the production spatial adapter.
 *
 * The application use case asks for a capability and never imports or constructs a vendor
 * provider. This module is the sole place where the registry-approved implementation id is
 * mapped to the concrete PostGIS adapter.
 */
export async function createLocalizationSpatialRuntime(): Promise<LocalizationSpatialRuntime> {
  const mimers = await MimersIntegration.create();
  const artifactRepository = mimers.artifactRepository;
  const provider = new SpatialProviderPostGIS(
    process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mimer",
    artifactRepository,
  );
  const resolver = new SpatialProviderResolver({
    registry: createLuRegistryRuntime(),
    providers: {
      [LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID]: provider,
    },
  });

  return {
    artifactRepository,
    resolveSpatialProvider: (capabilityKey) => resolver.resolve(capabilityKey),
    wgs84ToSweref99: (lat, lng) => provider.wgs84ToSweref99(lat, lng),
    close: () => provider.close(),
  };
}
