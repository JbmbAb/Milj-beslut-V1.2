import { parseHash } from '../serialization';

export interface CASDescriptor {
  readonly mediaType: string;
  readonly digest: string;
  readonly size: number;
}

export interface MimersBrunnManifest {
  readonly mediaType: 'application/vnd.mimers.manifest.v1+json' | 'application/vnd.mimers.manifest.v2+json';
  readonly schemaVersion: 'v1.0.0' | 'v2.0.0';
  readonly pipeline: CASDescriptor;
  readonly policySnapshot: CASDescriptor;
  readonly runtimeFingerprint: CASDescriptor;
  readonly metrics: CASDescriptor;
}

const MANIFEST_MEDIA_TYPES = {
  'v1.0.0': 'application/vnd.mimers.manifest.v1+json',
  'v2.0.0': 'application/vnd.mimers.manifest.v2+json',
} as const;

export type ManifestVersion = keyof typeof MANIFEST_MEDIA_TYPES;

export type MigratorFn = (oldManifest: MimersBrunnManifest) => MimersBrunnManifest;

export class SchemaMigrationRegistry {
  private migrators = new Map<string, MigratorFn>();

  registerMigrator(fromVersion: string, toVersion: string, migrator: MigratorFn): void {
    this.migrators.set(`${fromVersion}->${toVersion}`, migrator);
  }

  migrate(manifest: MimersBrunnManifest, targetVersion: ManifestVersion): MimersBrunnManifest {
    let current = manifest;
    const visited = new Set<string>();

    while (current.schemaVersion !== targetVersion) {
      if (visited.has(current.schemaVersion)) {
        throw new Error(`[S-02] Migration cycle detected at version '${current.schemaVersion}'.`);
      }
      visited.add(current.schemaVersion);

      const nextVersion: ManifestVersion | undefined =
        current.schemaVersion === 'v1.0.0' ? 'v2.0.0' : undefined;
      if (!nextVersion) {
        throw new Error(`[S-02] No migration path from '${current.schemaVersion}' to '${targetVersion}'.`);
      }

      const migrator = this.migrators.get(`${current.schemaVersion}->${nextVersion}`);
      if (!migrator) {
        throw new Error(`[S-02] Schema Migration Path Missing: '${current.schemaVersion}->${nextVersion}'.`);
      }
      current = migrator(current);
    }

    return validateManifest(current);
  }
}

export function validateDescriptor(desc: unknown, expectedMediaType?: string): CASDescriptor {
  if (typeof desc !== 'object' || desc === null) {
    throw new Error('Invalid descriptor: Must be an object.');
  }
  const d = desc as Record<string, unknown>;
  if (typeof d.mediaType !== 'string' || (expectedMediaType && d.mediaType !== expectedMediaType)) {
    throw new Error(`Invalid mediaType. Expected '${expectedMediaType}', got '${d.mediaType}'.`);
  }
  if (typeof d.digest !== 'string') {
    throw new Error('Invalid digest format: Must be a string address.');
  }
  try {
    parseHash(d.digest);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Descriptor verification failed: ${msg}`);
  }
  if (typeof d.size !== 'number' || !Number.isSafeInteger(d.size) || d.size < 0) {
    throw new Error('Descriptor size must be a non-negative safe integer.');
  }
  return desc as CASDescriptor;
}

export function validateManifest(obj: unknown): MimersBrunnManifest {
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('Invalid schema: Manifest must be an object.');
  }
  const m = obj as Record<string, unknown>;
  if (m.schemaVersion !== 'v1.0.0' && m.schemaVersion !== 'v2.0.0') {
    throw new Error(`[S-01] Unsupported schema version: '${String(m.schemaVersion)}'.`);
  }
  const expectedMediaType = MANIFEST_MEDIA_TYPES[m.schemaVersion as ManifestVersion];
  if (m.mediaType !== expectedMediaType) {
    throw new Error(
      `[S-01] Manifest mediaType / version mismatch. Version '${m.schemaVersion}' requires '${expectedMediaType}'.`,
    );
  }
  validateDescriptor(m.pipeline, 'application/vnd.mimers.pipeline.v1+json');
  validateDescriptor(m.policySnapshot, 'application/vnd.mimers.policy.v1+json');
  validateDescriptor(m.runtimeFingerprint, 'application/vnd.mimers.runtime.v1+json');
  validateDescriptor(m.metrics, 'application/vnd.mimers.metrics.v1+json');
  return obj as MimersBrunnManifest;
}

export { MANIFEST_MEDIA_TYPES };
