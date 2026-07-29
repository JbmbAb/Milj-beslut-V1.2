import type { CASRepository } from '../cas/CASRepository';
import {
  MANIFEST_MEDIA_TYPES,
  validateDescriptor,
  validateManifest,
  type CASDescriptor,
  type ManifestVersion,
  type MimersBrunnManifest,
} from './Manifest';

/** Media types for sealed manifest components (ADR-042). */
export const MANIFEST_COMPONENT_MEDIA_TYPES = {
  pipeline: 'application/vnd.mimers.pipeline.v1+json',
  policySnapshot: 'application/vnd.mimers.policy.v1+json',
  runtimeFingerprint: 'application/vnd.mimers.runtime.v1+json',
  metrics: 'application/vnd.mimers.metrics.v1+json',
} as const;

export type ManifestComponentKey = keyof typeof MANIFEST_COMPONENT_MEDIA_TYPES;

/**
 * Domain-agnostic inputs for a Mimers Brunn manifest.
 * Evolution (or any producer) supplies plain JSON-serializable values;
 * the builder owns CAS puts + descriptor assembly. Core must not import evolve.
 */
export interface ManifestBuildInput {
  readonly pipeline: unknown;
  readonly policySnapshot: unknown;
  readonly runtimeFingerprint: unknown;
  readonly metrics: unknown;
  /** Defaults to v1.0.0. */
  readonly schemaVersion?: ManifestVersion;
}

export interface SealedComponent extends CASDescriptor {
  readonly existed: boolean;
}

export interface ManifestBuildResult {
  readonly manifest: MimersBrunnManifest;
  readonly components: {
    readonly pipeline: SealedComponent;
    readonly policySnapshot: SealedComponent;
    readonly runtimeFingerprint: SealedComponent;
    readonly metrics: SealedComponent;
  };
}

export interface ManifestSealResult extends ManifestBuildResult {
  readonly manifestHash: string;
  readonly manifestExisted: boolean;
}

/**
 * Builds a validated MimersBrunnManifest by sealing each component into CAS.
 * This is the Evolution Engine terminus: pipeline/policy/runtime/metrics → manifest DAG.
 */
export class ManifestBuilder {
  constructor(private readonly cas: CASRepository) {}

  /**
   * Put four components, assemble descriptors, validate.
   * Does not put the manifest object itself (see {@link buildAndSeal}).
   */
  async build(input: ManifestBuildInput): Promise<ManifestBuildResult> {
    const schemaVersion = input.schemaVersion ?? 'v1.0.0';
    assertKnownVersion(schemaVersion);

    const pipeline = await this.sealComponent('pipeline', input.pipeline);
    const policySnapshot = await this.sealComponent('policySnapshot', input.policySnapshot);
    const runtimeFingerprint = await this.sealComponent('runtimeFingerprint', input.runtimeFingerprint);
    const metrics = await this.sealComponent('metrics', input.metrics);

    const manifest = validateManifest({
      mediaType: MANIFEST_MEDIA_TYPES[schemaVersion],
      schemaVersion,
      pipeline: toDescriptor(pipeline),
      policySnapshot: toDescriptor(policySnapshot),
      runtimeFingerprint: toDescriptor(runtimeFingerprint),
      metrics: toDescriptor(metrics),
    });

    return {
      manifest,
      components: { pipeline, policySnapshot, runtimeFingerprint, metrics },
    };
  }

  /** {@link build} then put the sealed manifest into CAS (idempotent). */
  async buildAndSeal(input: ManifestBuildInput): Promise<ManifestSealResult> {
    const built = await this.build(input);
    const { hash, existed } = await this.cas.put(built.manifest);
    return {
      ...built,
      manifestHash: hash,
      manifestExisted: existed,
    };
  }

  /**
   * Assemble a manifest from pre-existing CAS descriptors (no puts).
   * Useful when components were sealed earlier or adopted from migration.
   */
  buildFromDescriptors(
    descriptors: {
      readonly pipeline: CASDescriptor;
      readonly policySnapshot: CASDescriptor;
      readonly runtimeFingerprint: CASDescriptor;
      readonly metrics: CASDescriptor;
    },
    schemaVersion: ManifestVersion = 'v1.0.0',
  ): MimersBrunnManifest {
    assertKnownVersion(schemaVersion);
    return validateManifest({
      mediaType: MANIFEST_MEDIA_TYPES[schemaVersion],
      schemaVersion,
      pipeline: validateDescriptor(descriptors.pipeline, MANIFEST_COMPONENT_MEDIA_TYPES.pipeline),
      policySnapshot: validateDescriptor(
        descriptors.policySnapshot,
        MANIFEST_COMPONENT_MEDIA_TYPES.policySnapshot,
      ),
      runtimeFingerprint: validateDescriptor(
        descriptors.runtimeFingerprint,
        MANIFEST_COMPONENT_MEDIA_TYPES.runtimeFingerprint,
      ),
      metrics: validateDescriptor(descriptors.metrics, MANIFEST_COMPONENT_MEDIA_TYPES.metrics),
    });
  }

  private async sealComponent(key: ManifestComponentKey, payload: unknown): Promise<SealedComponent> {
    if (payload === undefined) {
      throw new TypeError(`ManifestBuilder: component '${key}' must not be undefined.`);
    }
    const { hash, size, existed } = await this.cas.put(payload);
    return {
      mediaType: MANIFEST_COMPONENT_MEDIA_TYPES[key],
      digest: hash,
      size,
      existed,
    };
  }
}

function toDescriptor(sealed: SealedComponent): CASDescriptor {
  return {
    mediaType: sealed.mediaType,
    digest: sealed.digest,
    size: sealed.size,
  };
}

function assertKnownVersion(version: ManifestVersion): void {
  if (!(version in MANIFEST_MEDIA_TYPES)) {
    throw new Error(`[S-01] Unsupported schema version: '${String(version)}'.`);
  }
}
