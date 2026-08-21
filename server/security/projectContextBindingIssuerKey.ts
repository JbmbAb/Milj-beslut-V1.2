import {
  LocalPemSigningKeyProvider,
  LocalPemVerificationKeyProvider,
  type SigningKeyProvider,
  type VerificationKeyProvider,
} from "@miljobeslut/mimers-brunn-core";

const PRIVATE_KEY_ENV = "PROJECT_CONTEXT_BINDING_ISSUER_PRIVATE_KEY_PEM";
const PUBLIC_KEY_ENV = "PROJECT_CONTEXT_BINDING_ISSUER_PUBLIC_KEY_PEM";
const KEY_ID_ENV = "PROJECT_CONTEXT_BINDING_ISSUER_KEY_ID";

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`REJECT_PROJECT_CONTEXT_BINDING_ISSUER_CONFIGURATION: ${name} is required`);
  return value;
}

/** Owner-side capability only. Product/runtime code must use the verifier below. */
export function getProjectContextBindingIssuerSigner(
  env: NodeJS.ProcessEnv = process.env,
): SigningKeyProvider {
  return new LocalPemSigningKeyProvider(
    required(env, KEY_ID_ENV),
    required(env, PRIVATE_KEY_ENV),
    required(env, PUBLIC_KEY_ENV),
  );
}

/** Public-key-only trust root for product binding verification. */
export function getProjectContextBindingIssuerVerifier(
  env: NodeJS.ProcessEnv = process.env,
): VerificationKeyProvider {
  return new LocalPemVerificationKeyProvider(
    required(env, KEY_ID_ENV),
    required(env, PUBLIC_KEY_ENV),
  );
}

