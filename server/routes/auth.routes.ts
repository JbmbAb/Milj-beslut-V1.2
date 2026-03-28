import express from "express";
import { rateLimitByUser } from "../security/rateLimit";
import { toSafeErrorResponse } from "../security/secureErrors";
import { initiateBankIdAuth, generateAnimatedQrPayload, collectBankIdAuth, cancelBankIdAuth, refreshSession } from "../services/bankIdService";
import { ensureAdminConsoleUser } from "../repositories/userRepository";
import { createTokenPair, requireAuth, revokeSession } from "../security/auth";

const router = express.Router();

router.post("/api/auth/bankid/init", rateLimitByUser(10, 60_000), async (req, res) => {
  try {
    const endUserIp = String(req.body?.endUserIp ?? req.ip);
    const orderTime = new Date();
    const order = await initiateBankIdAuth(endUserIp);
    const qrPayload = generateAnimatedQrPayload({
      qrStartToken: order.qrStartToken,
      qrStartSecret: order.qrStartSecret,
      orderTime,
    });
    res.json({ ok: true, ...order, orderTime: orderTime.toISOString(), qrPayload });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/auth/bankid/collect", rateLimitByUser(60, 60_000), async (req, res) => {
  try {
    const orderRef = String(req.body?.orderRef ?? "");
    const result = await collectBankIdAuth(orderRef);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/auth/bankid/cancel", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const orderRef = String(req.body?.orderRef ?? "");
    const result = await cancelBankIdAuth(orderRef);
    res.json({ ok: true, ...result });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/auth/refresh", rateLimitByUser(30, 60_000), async (req, res) => {
  try {
    const token = String(req.body?.refreshToken ?? "");
    const rotated = await refreshSession(token);
    res.json({ ok: true, ...rotated });
  } catch (error: unknown) {
    res.status(401).json(toSafeErrorResponse(error));
  }
});

router.post("/api/auth/logout", requireAuth, async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const refreshToken = req.body?.refreshToken;

    await revokeSession(accessToken, refreshToken);
    res.json({ ok: true, message: "Logged out successfully" });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

router.post("/api/admin/auth/login", rateLimitByUser(20, 60_000), async (req, res) => {
  try {
    const username = String(req.body?.username ?? "").trim();
    const password = String(req.body?.password ?? "");

    const expectedUsername = String(process.env.ADMIN_CONSOLE_USERNAME || "admin").trim();
    const expectedPassword = String(process.env.ADMIN_CONSOLE_PASSWORD || "");
    if (!expectedPassword) {
      res.status(503).json({ ok: false, error: "Admin login is not configured (ADMIN_CONSOLE_PASSWORD missing)." });
      return;
    }

    if (!username || username !== expectedUsername || password !== expectedPassword) {
      res.status(401).json({ ok: false, error: "Invalid admin credentials" });
      return;
    }

    const user = await ensureAdminConsoleUser(username);
    const tokens = createTokenPair(user);
    res.json({
      ok: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        role: user.role,
        organisationId: user.organisationId,
      },
    });
  } catch (error: unknown) {
    res.status(400).json(toSafeErrorResponse(error));
  }
});

export default router;
