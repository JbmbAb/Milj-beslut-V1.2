import { describe, expect, it } from 'vitest';
import { LocalPemSigningKeyProvider } from '@miljobeslut/mimers-brunn-core';
import {
  createLocalizationGeometrySupersessionIssuerArtifact,
  type LocalizationGeometrySupersessionIssuerArtifact,
} from '@miljobeslut/mps-lu';
import {
  attestLocalizationGeometrySupersessionIssuerArtifact,
  verifyLocalizationGeometrySupersessionIssuerArtifact,
} from '../../server/modules/localization/localizationGeometrySupersessionAuthority';

const OWNER_AUTHORITY_REF = {
  artifact_id: 'owner-authority-geometry-supersession-integrity-test',
  artifact_type: 'owner_authority_attestation',
} as const;

async function signedIssuer(): Promise<{
  readonly issuer: LocalizationGeometrySupersessionIssuerArtifact;
  readonly verification: LocalPemSigningKeyProvider;
}> {
  const key = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-integrity-test');
  const unsigned = createLocalizationGeometrySupersessionIssuerArtifact({
    issuer_key_id: key.provider.keyId,
    owner_authority_ref: OWNER_AUTHORITY_REF,
  });
  return {
    issuer: {
      ...unsigned,
      attestation: await attestLocalizationGeometrySupersessionIssuerArtifact({ issuer: unsigned, signing: key.provider }),
    },
    verification: key.provider,
  };
}

describe('LOCALIZATION-GEOMETRY-SUPERSESSION-ISSUER-INTEGRITY-HARDENING-01', () => {
  it('accepts a self-consistent issuer with a trusted signature', async () => {
    const { issuer, verification } = await signedIssuer();

    await expect(verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer, verification })).resolves.toBeUndefined();
  });

  it('rejects owner-authority mutation even when a stale content hash and signature remain valid', async () => {
    const { issuer, verification } = await signedIssuer();
    const tampered: LocalizationGeometrySupersessionIssuerArtifact = {
      ...issuer,
      payload: {
        ...issuer.payload,
        owner_authority_ref: {
          ...issuer.payload.owner_authority_ref,
          artifact_id: 'owner-authority-tampered-after-attestation',
        },
      },
    };

    await expect(verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer: tampered, verification }))
      .rejects.toThrow('REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CANONICAL_INTEGRITY');
  });

  it('rejects a stale signature over an issuer with altered artifact identity, content hash, or references', async () => {
    const { issuer, verification } = await signedIssuer();
    const altered = [
      { ...issuer, artifact_id: `${issuer.artifact_id}-tampered` },
      { ...issuer, content_hash: { ...issuer.content_hash, value: '0'.repeat(64) } },
      { ...issuer, references: [] },
    ] as const;

    for (const candidate of altered) {
      await expect(verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer: candidate, verification }))
        .rejects.toThrow('REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_CANONICAL_INTEGRITY');
    }
  });

  it('rejects a valid issuer when verification is attempted with another trusted-key identity', async () => {
    const { issuer } = await signedIssuer();
    const wrongKey = LocalPemSigningKeyProvider.generate('ed25519:geometry-supersession-wrong-verifier').provider;

    await expect(verifyLocalizationGeometrySupersessionIssuerArtifact({ issuer, verification: wrongKey }))
      .rejects.toThrow('REJECT_LOCALIZATION_GEOMETRY_SUPERSESSION_ISSUER_TRUST_ROOT');
  });
});
