import { describe, expect, it } from 'vitest';
import {
  deriveIdentityFromPath,
  joinCASRoot,
  readDigestFromCASPath,
  resolveObjectPath,
} from '../src/CASPathResolver';
import { CASRuntimeBoundary } from '../src/CASRuntimeBoundary';
import { digestBytes } from '../src/CASWriteOnceRepository';

const DIGEST = digestBytes(new TextEncoder().encode('decision-impact-1'));

function withEnvironment<T>(env: Record<string, string>, run: () => T): T {
  const previous = { ...process.env };
  Object.assign(process.env, env);
  try {
    return run();
  } finally {
    process.env = previous;
  }
}

describe('Commit H.2: CAS Physical Boundary', () => {
  describe('CAS-I05: Path Determinism', () => {
    it('hash X ger samma path i miljö A och miljö B', () => {
      const pathInA = withEnvironment(
        { MIMER_CAS_ROOT: '/mnt/disk-a/mimer-cas', NODE_ENV: 'production', TZ: 'UTC' },
        () => resolveObjectPath(DIGEST),
      );
      const pathInB = withEnvironment(
        { MIMER_CAS_ROOT: 'D:\\mimer\\cas', NODE_ENV: 'test', TZ: 'Europe/Stockholm' },
        () => resolveObjectPath(DIGEST),
      );

      expect(pathInA).toEqual(pathInB);
      expect(pathInA.relativePath).toBe(`objects/sha256/${pathInA.digest.slice(0, 2)}/${pathInA.digest.slice(2)}`);
    });

    it('prefixad och bar digest ger samma path', () => {
      const bare = DIGEST.split(':')[1];
      expect(resolveObjectPath(bare)).toEqual(resolveObjectPath(DIGEST));
    });

    it('roten appliceras enbart i det fysiska lagret', () => {
      const location = resolveObjectPath(DIGEST);
      expect(joinCASRoot('/mnt/disk-a/mimer-cas/', location)).toBe(`/mnt/disk-a/mimer-cas/${location.relativePath}`);
      expect(joinCASRoot('D:\\mimer\\cas', location)).toBe(`D:\\mimer\\cas/${location.relativePath}`);
    });

    it('något som inte är en CAS-digest kan aldrig bli en path', () => {
      expect(() => resolveObjectPath('not-a-digest')).toThrowError('CAS_INVALID_HASH');
      expect(() => resolveObjectPath('md5:abc')).toThrowError('CAS_INVALID_HASH');
    });
  });

  describe('CAS-I06: No Reverse Identity', () => {
    it('en CAS-path kan lokalisera ett objekt', () => {
      const location = resolveObjectPath(DIGEST);
      const physical = joinCASRoot('/mimer-cas', location);

      expect(readDigestFromCASPath(physical)).toEqual({ algorithm: 'sha256', digest: location.digest });
      expect(readDigestFromCASPath(physical.replace(/\//g, '\\'))).toEqual({
        algorithm: 'sha256',
        digest: location.digest,
      });
    });

    it('en godtycklig filsökväg kan aldrig skapa identitet', () => {
      expect(readDigestFromCASPath('/some/path/file.pdf')).toBeNull();
      expect(readDigestFromCASPath('/mimer-cas/objects/sha256/aa/bb')).toBeNull();
      expect(readDigestFromCASPath('/mimer-cas/objects/md5/aa/bbccdd')).toBeNull();
      expect(() => deriveIdentityFromPath('/some/path/file.pdf')).toThrowError('CAS_REVERSE_IDENTITY_FORBIDDEN');
    });

    it('resolvern går bara i riktningen hash -> path', () => {
      const location = resolveObjectPath(DIGEST);
      const roundTripped = readDigestFromCASPath(location.relativePath);

      expect(roundTripped?.digest).toBe(location.digest);
      expect(() => deriveIdentityFromPath(location.relativePath)).toThrowError('CAS_REVERSE_IDENTITY_FORBIDDEN');
    });
  });

  describe('CAS-I07: Runtime Isolation', () => {
    const decisionArtifact = {
      artifact_type: 'DecisionImpactArtifact',
      canonical_hash: DIGEST,
      canonical_version: 'dg-canonical-1',
    };

    it('runtime.store(decisionArtifact) kastar CAS_RUNTIME_AUTHORITY_VIOLATION', () => {
      const runtime = new CASRuntimeBoundary('runtime');
      expect(() => runtime.store(decisionArtifact)).toThrowError('CAS_RUNTIME_AUTHORITY_VIOLATION');
    });

    it('runtime.save(DecisionImpactArtifact) stoppas av samma guard', () => {
      const runtime = new CASRuntimeBoundary('snapshots');
      expect(() => runtime.save(decisionArtifact)).toThrowError('CAS_RUNTIME_AUTHORITY_VIOLATION');
    });

    it('avvisad auktoritet lämnar inget spår i runtime-lagret', () => {
      const runtime = new CASRuntimeBoundary('cache');
      expect(() => runtime.store(decisionArtifact, 'impact-1')).toThrowError('CAS_RUNTIME_AUTHORITY_VIOLATION');
      expect(runtime.read('impact-1')).toBeNull();
    });

    it('härlett runtime-tillstånd är tillåtet och kastbart', () => {
      const runtime = new CASRuntimeBoundary('runtime');
      const handle = runtime.store({ kind: 'ReplayCursor', event_position: 100 }, 'cursor');

      expect(handle).toEqual({ namespace: 'runtime', key: 'cursor' });
      runtime.discard();
      expect(runtime.read('cursor')).toBeNull();
    });
  });
});
