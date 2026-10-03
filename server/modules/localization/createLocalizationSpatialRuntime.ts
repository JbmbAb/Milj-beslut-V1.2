import {
  createLuRegistryRuntime,
  LU_SPATIAL_PROVIDER_IMPLEMENTATION_ID,
  SpatialProviderResolver,
  type ISpatialProvider,
} from "@miljobeslut/mps-lu";
import { MimersIntegration, type ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { SpatialProviderPostGIS } from "@miljobeslut/spatial-provider-postgis";
import { requireDatabaseUrl } from "../runtime-env/runtimeDatabaseUrl";

export interface LocalizationSpatialRuntime {
  readonly artifactRepository: ArtifactRepositoryPort;
  resolveSpatialProvider(capabilityKey: string): ISpatialProvider;
  wgs84ToSweref99(lat: number, lng: number): Promise<readonly [number, number]>;
  /** PRODUCT-LU-LOCALIZATION-GEOMETRY-01 -- see SpatialProviderPostGIS.sweref99ToWgs84. */
  sweref99ToWgs84(northing: number, easting: number): Promise<readonly [number, number]>;
  close(): Promise<void>;
}

/**
 * P4A-LU-05 composition root for the production spatial adapter.
 *
 * The application use case asks for a capability and never imports or constructs a vendor
 * provider. This module is the sole place where the registry-approved implementation id is
 * mapped to the concrete PostGIS adapter.
 *
 * W-U402 (U40-2, spec U40-U50B §0 point 4 / §1.3): there is no default database. Without DATABASE_URL (absent or
 * blank) the runtime refuses with DATABASE_URL_REQUIRED before anything is opened -- no CAS, no provider, no pool --
 * instead of querying a built-in credential URL on the local host. The caller's failure path stays fail-closed (no
 * assessment, no verdict).
 */
export async function createLocalizationSpatialRuntime(): Promise<LocalizationSpatialRuntime> {
  const databaseUrl = requireDatabaseUrl(process.env, "the localization spatial runtime");
  const mimers = await MimersIntegration.create();
  const artifactRepository = mimers.artifactRepository;
  const provider = new SpatialProviderPostGIS(databaseUrl, artifactRepository);
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
    sweref99ToWgs84: (northing, easting) => provider.sweref99ToWgs84(northing, easting),
    close: () => provider.close(),
  };
}
