import type { CASRepository } from '../cas/CASRepository';
import { DescriptorFactory, type StoredDescriptor } from './DescriptorFactory';
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
 * Domain-agnostic inputs for a Mimers Brunn manifest (batch form).
 * Prefer fluent setters when cutting over EvolutionOrchestrator.
 */
export interface ManifestBuildInput {
  readonly pipeline: unknown;
  readonly policySnapshot: unknown;
  readonly runtimeFingerprint: unknown;
  readonly metrics: unknown;
  /** Defaults to v1.0.0. */
  readonly schemaVersion?: ManifestVersion;
}

/** @deprecated Prefer StoredDescriptor — alias kept for call-site compatibility. */
export type SealedComponent = StoredDescriptor;

export interface ManifestBuildResult {
  readonly manifest: MimersBrunnManifest;
  readonly components: {
    readonly pipeline: StoredDescriptor;
    readonly policySnapshot: StoredDescriptor;
    readonly runtimeFingerprint: StoredDescriptor;
    readonly metrics: StoredDescriptor;
  };
}

export interface ManifestSealResult extends ManifestBuildResult {
  readonly manifestHash: string;
  readonly manifestExisted: boolean;
}

/**
 * Fluent builder: domain payloads → DescriptorFactory → validated MimersBrunnManifest.
 * Callers never touch digest/size/mediaType/canonicalization.
 *
 * @example
 * ```ts
 * const { manifest } = await new ManifestBuilder(cas)
 *   .pipeline(pipeline)
 *   .policy(policy)
 *   .runtime(runtime)
 *   .metrics(metrics)
 *   .build();
 * ```
 */
export class ManifestBuilder {
  private readonly factory: DescriptorFactory;
  private readonly cas: CASRepository;

  private pipelinePayload: unknown = undefined;
  private policyPayload: unknown = undefined;
  private runtimePayload: unknown = undefined;
  private metricsPayload: unknown = undefined;
  private version: ManifestVersion = 'v1.0.0';

  constructor(casOrFactory: CASRepository | DescriptorFactory) {
    if (casOrFactory instanceof DescriptorFactory) {
      this.factory = casOrFactory;
      this.cas = casOrFactory.cas;
    } else {
      this.cas = casOrFactory;
      this.factory = new DescriptorFactory(casOrFactory);
    }
  }

  /** Underlying descriptor factory (sole CASDescriptor creator). */
  get descriptorFactory(): DescriptorFactory {
    return this.factory;
  }

  pipeline(payload: unknown): this {
    this.pipelinePayload = payload;
    return this;
  }

  /** Alias for policySnapshot (fluent cutover API). */
  policy(payload: unknown): this {
    this.policyPayload = payload;
    return this;
  }

  policySnapshot(payload: unknown): this {
    return this.policy(payload);
  }

  /** Alias for runtimeFingerprint (fluent cutover API). */
  runtime(payload: unknown): this {
    this.runtimePayload = payload;
    return this;
  }

  runtimeFingerprint(payload: unknown): this {
    return this.runtime(payload);
  }

  metrics(payload: unknown): this {
    this.metricsPayload = payload;
    return this;
  }

  schemaVersion(version: ManifestVersion): this {
    assertKnownVersion(version);
    this.version = version;
    return this;
  }

  /**
   * Seal components via DescriptorFactory and assemble a validated manifest.
   * Does not put the manifest object itself (see {@link buildAndSeal}).
   * Optional batch `input` applies fluent setters then builds (compat).
   */
  async build(input?: ManifestBuildInput): Promise<ManifestBuildResult> {
    if (input) {
      this.pipeline(input.pipeline)
        .policy(input.policySnapshot)
        .runtime(input.runtimeFingerprint)
        .metrics(input.metrics);
      if (input.schemaVersion) this.schemaVersion(input.schemaVersion);
    }

    assertKnownVersion(this.version);
    assertDefined('pipeline', this.pipelinePayload);
    assertDefined('policySnapshot', this.policyPayload);
    assertDefined('runtimeFingerprint', this.runtimePayload);
    assertDefined('metrics', this.metricsPayload);

    const pipeline = await this.factory.store(
      this.pipelinePayload,
      MANIFEST_COMPONENT_MEDIA_TYPES.pipeline,
    );
    const policySnapshot = await this.factory.store(
      this.policyPayload,
      MANIFEST_COMPONENT_MEDIA_TYPES.policySnapshot,
    );
    const runtimeFingerprint = await this.factory.store(
      this.runtimePayload,
      MANIFEST_COMPONENT_MEDIA_TYPES.runtimeFingerprint,
    );
    const metrics = await this.factory.store(
      this.metricsPayload,
      MANIFEST_COMPONENT_MEDIA_TYPES.metrics,
    );

    const manifest = validateManifest({
      mediaType: MANIFEST_MEDIA_TYPES[this.version],
      schemaVersion: this.version,
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
  async buildAndSeal(input?: ManifestBuildInput): Promise<ManifestSealResult> {
    const built = await this.build(input);
    const sealedManifest = await this.factory.store(
      built.manifest,
      MANIFEST_MEDIA_TYPES[built.manifest.schemaVersion],
    );
    return {
      ...built,
      manifestHash: sealedManifest.digest,
      manifestExisted: sealedManifest.existed,
    };
  }

  /**
   * Assemble a manifest from pre-existing CAS descriptors (no puts).
   * Adoption/migration only — does not create descriptors.
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
}

function toDescriptor(sealed: StoredDescriptor): CASDescriptor {
  return {
    mediaType: sealed.mediaType,
    digest: sealed.digest,
    size: sealed.size,
  };
}

function assertDefined(name: string, value: unknown): void {
  if (value === undefined) {
    throw new TypeError(`ManifestBuilder: component '${name}' must not be undefined.`);
  }
}

function assertKnownVersion(version: ManifestVersion): void {
  if (!(version in MANIFEST_MEDIA_TYPES)) {
    throw new Error(`[S-01] Unsupported schema version: '${String(version)}'.`);
  }
}
