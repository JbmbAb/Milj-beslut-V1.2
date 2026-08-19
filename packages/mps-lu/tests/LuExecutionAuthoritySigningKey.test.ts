import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPemSigningKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";
import {
  getLuExecutionAuthoritySigningProvider,
  __resetLuExecutionAuthoritySigningProviderForTests,
} from "../../../server/security/luExecutionAuthoritySigningKey.js";
import {
  getLuExecutionAuthorityVerifier,
  __resetLuExecutionAuthorityVerifierForTests,
} from "../src/execution/LuExecutionAuthorityVerifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * PROD-LU-ADMISSION-02B — the authority side can mint, the consumer side can only verify.
 */
describe("LU execution authority signer/verifier — capability separation", () => {
  const ENV_VARS = [
    "LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM",
    "LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM",
    "LU_EXECUTION_AUTHORITY_SIGNING_KEY_ID",
  ] as const;
  const originalEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    __resetLuExecutionAuthoritySigningProviderForTests(null);
    __resetLuExecutionAuthorityVerifierForTests(null);
  });

  function setEnv(name: (typeof ENV_VARS)[number], value: string | undefined) {
    if (!(name in originalEnv)) originalEnv[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  it("fails closed when signing key env vars are missing", () => {
    setEnv("LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM", undefined);
    setEnv("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM", undefined);
    expect(() => getLuExecutionAuthoritySigningProvider()).toThrow(
      /Missing LU execution authority signing key configuration/,
    );
  });

  it("fails closed when the verification key env var is missing", () => {
    setEnv("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM", undefined);
    expect(() => getLuExecutionAuthorityVerifier()).toThrow(
      /Missing LU execution authority verification key configuration/,
    );
  });

  it("authority provider signs, and verifies its own signature with the matching keypair", async () => {
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate();
    setEnv("LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM", privateKey);
    setEnv("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM", publicKey);

    const signer = getLuExecutionAuthoritySigningProvider();
    const payload = new TextEncoder().encode("prod-lu-admission-02b-proof");
    const envelope = await signer.sign(payload);

    expect(await signer.verify(payload, envelope)).toBe(true);
  });

  it("consumer verifier accepts a signature made by the matching authority key", async () => {
    const { publicKey, privateKey } = LocalPemSigningKeyProvider.generate();
    setEnv("LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM", privateKey);
    setEnv("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM", publicKey);

    const signer = getLuExecutionAuthoritySigningProvider();
    const verifier: VerificationKeyProvider = getLuExecutionAuthorityVerifier();
    const payload = new TextEncoder().encode("prod-lu-admission-02b-proof");
    const envelope = await signer.sign(payload);

    expect(await verifier.verify(payload, envelope)).toBe(true);
  });

  it("consumer verifier rejects a signature made by an unrelated key", async () => {
    const authorityKeys = LocalPemSigningKeyProvider.generate("ed25519:lu-execution-authority-v1");
    const impostor = LocalPemSigningKeyProvider.generate("ed25519:impostor");

    setEnv("LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM", authorityKeys.privateKey);
    setEnv("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM", authorityKeys.publicKey);

    const verifier = getLuExecutionAuthorityVerifier();
    const payload = new TextEncoder().encode("prod-lu-admission-02b-proof");
    const forgedEnvelope = await impostor.provider.sign(payload);

    expect(await verifier.verify(payload, forgedEnvelope)).toBe(false);
  });

  it("consumer verifier is structurally VerificationKeyProvider -- no sign() capability exists on it", () => {
    const { publicKey } = LocalPemSigningKeyProvider.generate();
    setEnv("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM", publicKey);

    const verifier = getLuExecutionAuthorityVerifier();
    // Not a refusal at call time -- there is no method to call. LocalPemVerificationKeyProvider
    // holds no private key material at all, so this is absent by construction.
    expect((verifier as unknown as Record<string, unknown>).sign).toBeUndefined();
    // @ts-expect-error VerificationKeyProvider has no sign() -- this must fail to compile.
    void verifier.sign;
  });

  it("the consumer module never references the private key env var or the authority signing module", () => {
    const consumerSrc = readFileSync(
      path.join(__dirname, "../src/execution/LuExecutionAuthorityVerifier.ts"),
      "utf8",
    );
    // Excludes this file's own explanatory doc comment, which names the forbidden var/module by
    // design (to document the boundary) -- the proof is that no *code* reads or imports them.
    expect(consumerSrc).not.toContain("process.env.LU_EXECUTION_AUTHORITY_PRIVATE_KEY_PEM");
    expect(consumerSrc).not.toMatch(/^import.*LocalPemSigningKeyProvider/m);
    expect(consumerSrc).not.toMatch(/^import.*luExecutionAuthoritySigningKey/m);
    expect(consumerSrc).toContain("LocalPemVerificationKeyProvider");
    expect(consumerSrc).toContain("LU_EXECUTION_AUTHORITY_PUBLIC_KEY_PEM");
  });
});
