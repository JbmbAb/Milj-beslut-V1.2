const requiredEnv = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "LANTMATERIET_BASE_URL",
] as const;

export function assertSecurityEnv(): void {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required security env variables: ${missing.join(", ")}`);
  }

  if (!isLantmaterietOpenMode() && !process.env.LANTMATERIET_API_KEY) {
    throw new Error("Missing env variable: LANTMATERIET_API_KEY (set LANTMATERIET_OPEN_MODE=true for open-map-only testing)");
  }
}

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env variable: ${name}`);
  }
  return value;
}

export function assertBankIdEnv(): void {
  const hasPfx = Boolean(process.env.BANKID_PFX_PATH);
  const hasPemPair = Boolean(process.env.BANKID_CERT_PATH && process.env.BANKID_KEY_PATH);
  if (!hasPfx && !hasPemPair) {
    throw new Error("BankID mTLS config missing: set BANKID_PFX_PATH or BANKID_CERT_PATH+BANKID_KEY_PATH");
  }

  if (!process.env.BANKID_BASE_URL) {
    throw new Error("Missing env variable: BANKID_BASE_URL");
  }
}

export function assertSluEnv(): void {
  if (!process.env.SLU_API_KEY) {
    throw new Error("Missing env variable: SLU_API_KEY");
  }
  if (!process.env.SLU_API_BASE_URL) {
    throw new Error("Missing env variable: SLU_API_BASE_URL");
  }
}

export function isLantmaterietOpenMode(): boolean {
  return String(process.env.LANTMATERIET_OPEN_MODE || "").toLowerCase() === "true";
}
