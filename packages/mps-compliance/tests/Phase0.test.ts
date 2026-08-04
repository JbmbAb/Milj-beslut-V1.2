import { describe, it, expect } from 'vitest';
import { ArtifactId } from '../src/artifacts/ArtifactId';
import { ArtifactType } from '../src/artifacts/ArtifactType';
import { ContentHash } from '../src/artifacts/ContentHash';
import { ArtifactReference } from '../src/artifacts/ArtifactReference';
import { ArtifactContract } from '../src/artifacts/ArtifactContract';
import { CanonicalBytes } from '../src/canonical/CanonicalBytes';
import { CanonicalSerializer } from '../src/canonical/CanonicalSerializer';

describe('Phase 0 - Canonical Foundation (Optimized)', () => {
  it('should enforce the ArtifactContract shape with artifact_id and content_hash', () => {
    const id: ArtifactId = '456';
    const type: ArtifactType = 'Document';
    const hash: ContentHash = { algorithm: 'sha256', value: 'def' };

    const artifact: ArtifactContract = {
      artifact_id: id,
      artifact_type: type,
      content_hash: hash,
      references: []
    };

    expect(artifact.artifact_id).toBe('456');
    expect(artifact.content_hash.value).toBe('def');
    // Ensure it does not have mutable serialization methods by design
    expect((artifact as any).toJSON).toBeUndefined();
  });
});
