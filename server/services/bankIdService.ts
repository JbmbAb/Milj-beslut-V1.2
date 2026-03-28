import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import { createTokenPair, rotateRefreshToken } from "../security/auth";
import { assertBankIdEnv, getEnv } from "../security/env";
import { findAuthUserByBankId } from "../repositories/userRepository";

interface BankIdAuthResponse {
  orderRef: string;
  autoStartToken: string;
  qrStartToken: string;
  qrStartSecret: string;
}

interface BankIdCollectRequest {
  orderRef: string;
}

interface BankIdCollectResponse {
  orderRef: string;
  status: "pending" | "failed" | "complete";
  hintCode?: string;
  completionData?: {
    user: {
      personalNumber: string;
      givenName: string;
      surname: string;
      name: string;
    };
    device: {
      ipAddress: string;
    };
    cert: {
      notBefore: string;
      notAfter: string;
    };
    signature: string;
    ocspResponse: string;
  };
}

function buildAgent(): https.Agent {
  const pfxPath = process.env.BANKID_PFX_PATH;
  if (pfxPath) {
    return new https.Agent({
      pfx: fs.readFileSync(pfxPath),
      passphrase: process.env.BANKID_PFX_PASSPHRASE,
      ca: process.env.BANKID_CA_PATH ? fs.readFileSync(process.env.BANKID_CA_PATH) : undefined,
      minVersion: "TLSv1.2",
    });
  }

  return new https.Agent({
    cert: fs.readFileSync(getEnv("BANKID_CERT_PATH")),
    key: fs.readFileSync(getEnv("BANKID_KEY_PATH")),
    ca: process.env.BANKID_CA_PATH ? fs.readFileSync(process.env.BANKID_CA_PATH) : undefined,
    minVersion: "TLSv1.2",
  });
}

function postBankId<TRequest extends object, TResponse>(path: string, payload: TRequest): Promise<TResponse> {
  assertBankIdEnv();
  const baseUrl = new URL(getEnv("BANKID_BASE_URL"));
  const body = JSON.stringify(payload);
  const agent = buildAgent();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: baseUrl.protocol,
        hostname: baseUrl.hostname,
        port: baseUrl.port || 443,
        path: `${baseUrl.pathname.replace(/\/$/, "")}${path}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        agent,
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`BankID request failed (${res.statusCode}): ${text}`));
            return;
          }
          try {
            resolve(JSON.parse(text) as TResponse);
          } catch {
            reject(new Error("Invalid JSON response from BankID"));
          }
        });
      },
    );

    req.on("timeout", () => req.destroy(new Error("BankID request timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function initiateBankIdAuth(endUserIp: string): Promise<BankIdAuthResponse> {
  const payload = { endUserIp };
  return postBankId<typeof payload, BankIdAuthResponse>("/auth", payload);
}

function qrAuthCode(qrStartSecret: string, elapsedSeconds: number): string {
  return crypto.createHmac("sha256", qrStartSecret).update(String(elapsedSeconds)).digest("hex");
}

export function generateAnimatedQrPayload(input: {
  qrStartToken: string;
  qrStartSecret: string;
  orderTime: Date;
  now?: Date;
}): string {
  const current = input.now ?? new Date();
  const elapsedSeconds = Math.max(0, Math.floor((current.getTime() - input.orderTime.getTime()) / 1000));
  const authCode = qrAuthCode(input.qrStartSecret, elapsedSeconds);
  return `bankid.${input.qrStartToken}.${elapsedSeconds}.${authCode}`;
}

export async function collectBankIdAuth(orderRef: string) {
  const response = await postBankId<BankIdCollectRequest, BankIdCollectResponse>("/collect", { orderRef });

  if (response.status !== "complete") {
    return {
      status: response.status,
      hintCode: response.hintCode ?? null,
    };
  }

  const bankidId = response.completionData?.user?.personalNumber;
  if (!bankidId) {
    throw new Error("BankID complete response missing personal number");
  }

  const user = await findAuthUserByBankId(bankidId);
  if (!user) {
    throw new Error("Authenticated BankID user is not registered in a permitted organisation");
  }

  const pair = createTokenPair(user);
  return {
    status: "complete" as const,
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    user: {
      id: user.id,
      organisationId: user.organisationId,
      role: user.role,
    },
  };
}

export async function cancelBankIdAuth(orderRef: string): Promise<{ cancelled: boolean }> {
  await postBankId<{ orderRef: string }, { message?: string }>("/cancel", { orderRef });
  return { cancelled: true };
}

export async function refreshSession(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  const rotated = await rotateRefreshToken(refreshToken);
  return {
    accessToken: rotated.accessToken,
    refreshToken: rotated.refreshToken,
  };
}
