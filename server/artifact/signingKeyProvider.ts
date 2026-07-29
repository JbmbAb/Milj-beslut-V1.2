/**
 * Abstraction for AES signing keys. Local PEM for dev/test; KMS later.
 */
export interface SigningKeyProvider {
  readonly signingKeyId: string;
  getPrivateKey(): string | Promise<string>;
  getPublicKey?(): string | Promise<string | undefined>;
}

export class LocalPemSigningKeyProvider implements SigningKeyProvider {
  constructor(
    readonly signingKeyId: string,
    private readonly privateKeyPem: string,
    private readonly publicKeyPem?: string,
  ) {}

  getPrivateKey(): string {
    return this.privateKeyPem;
  }

  getPublicKey(): string | undefined {
    return this.publicKeyPem;
  }
}
