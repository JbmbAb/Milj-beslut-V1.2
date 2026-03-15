import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "./types";
import { getEnv } from "./env";
import { isTokenRevoked, markRefreshTokenAsUsed } from "../repositories/tokenRepository";

const accessTtlSeconds = 60 * 15;
const refreshTtlSeconds = 60 * 60 * 24 * 7;

function b64url(input: Buffer | string): string {
  const raw = Buffer.isBuffer(input) ? input.toString("base64") : Buffer.from(input, "utf8").toString("base64");
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function hmac(data: string, secret: string): string {
  return b64url(crypto.createHmac("sha256", secret).update(data).digest());
}

function decodeB64UrlJson<T>(input: string): T {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf8")) as T;
}

interface JwtPayload {
  sub: string;
  organisationId: string;
  bankidId: string;
  role: AuthUser["role"];
  type: "access" | "refresh";
  jti: string;
  iat: number;
  exp: number;
}

export function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt<T>(token: string, secret: string): T & { exp: number } {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) {
    throw new Error("Malformed token");
  }
  const expected = hmac(`${h}.${p}`, secret);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) {
    throw new Error("Invalid signature");
  }
  const payload = decodeB64UrlJson<T & { exp: number }>(p);
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("Token expired");
  }
  return payload;
}

export function createTokenPair(user: AuthUser): { accessToken: string; refreshToken: string } {
  const now = Math.floor(Date.now() / 1000);
  const common = {
    sub: user.id,
    organisationId: user.organisationId,
    bankidId: user.bankidId,
    role: user.role,
    iat: now,
  };

  const accessPayload: JwtPayload = {
    ...common,
    type: "access",
    jti: crypto.randomUUID(),
    exp: now + accessTtlSeconds,
  };

  const refreshPayload: JwtPayload = {
    ...common,
    type: "refresh",
    jti: crypto.randomUUID(),
    exp: now + refreshTtlSeconds,
  };

  return {
    accessToken: signJwt(accessPayload, getEnv("JWT_ACCESS_SECRET")),
    refreshToken: signJwt(refreshPayload, getEnv("JWT_REFRESH_SECRET")),
  };
}

export async function rotateRefreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; user: AuthUser }> {
  const payload = verifyJwt<JwtPayload>(refreshToken, getEnv("JWT_REFRESH_SECRET"));
  if (payload.type !== "refresh") {
    throw new Error("Invalid token type");
  }

  // Check if token has already been used (prevents reuse attacks)
  const isRevoked = await isTokenRevoked(payload.jti);
  if (isRevoked) {
    throw new Error("Refresh token reuse detected - possible security breach");
  }

  // Mark token as used immediately
  const expiresAt = new Date(payload.exp * 1000);
  await markRefreshTokenAsUsed(payload.sub, payload.jti, expiresAt);

  const user: AuthUser = {
    id: payload.sub,
    organisationId: payload.organisationId,
    bankidId: payload.bankidId,
    role: payload.role,
  };
  const next = createTokenPair(user);
  return { ...next, user };
}

declare module "express-serve-static-core" {
  interface Request {
    authUser?: AuthUser;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Missing bearer token" });
    return;
  }

  try {
    const token = raw.slice("Bearer ".length);
    req.authUser = getUserFromAccessToken(token);
    next();
  } catch {
    res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

export function getUserFromAccessToken(token: string): AuthUser {
  const payload = verifyJwt<JwtPayload>(token, getEnv("JWT_ACCESS_SECRET"));
  if (payload.type !== "access") {
    throw new Error("Invalid access token");
  }
  return {
    id: payload.sub,
    organisationId: payload.organisationId,
    bankidId: payload.bankidId,
    role: payload.role,
  };
}
