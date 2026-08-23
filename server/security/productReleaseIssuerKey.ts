import { LocalPemSigningKeyProvider, LocalPemVerificationKeyProvider, type SigningKeyProvider, type VerificationKeyProvider } from "@miljobeslut/mimers-brunn-core";

const KEY = "PRODUCT_RELEASE_ISSUER_KEY_ID";
const PRIVATE = "PRODUCT_RELEASE_ISSUER_PRIVATE_KEY_PEM";
const PUBLIC = "PRODUCT_RELEASE_ISSUER_PUBLIC_KEY_PEM";
function required(env: NodeJS.ProcessEnv, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`REJECT_PRODUCT_RELEASE_ISSUER_CONFIGURATION: ${key} is required`); return value; }
export function getProductReleaseIssuerSigner(env: NodeJS.ProcessEnv = process.env): SigningKeyProvider { return new LocalPemSigningKeyProvider(required(env, KEY), required(env, PRIVATE), required(env, PUBLIC)); }
export function getProductReleaseIssuerVerifier(env: NodeJS.ProcessEnv = process.env): VerificationKeyProvider { return new LocalPemVerificationKeyProvider(required(env, KEY), required(env, PUBLIC)); }
