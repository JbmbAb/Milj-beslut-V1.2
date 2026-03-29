import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  verifyAuditTrail: vi.fn(),
  fetchFn: vi.fn(),
}));

vi.mock("../../server/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
  },
}));

vi.mock("../../server/security/auditTrail", () => ({
  verifyAuditTrail: mocks.verifyAuditTrail,
}));

// Mocka global fetch
vi.stubGlobal("fetch", mocks.fetchFn);

import {
  getAuditVerificationStatus,
  runAuditVerificationOnce,
  startAuditVerificationScheduler,
  stopAuditVerificationScheduler,
} from "../../server/services/auditVerificationScheduler";

describe("auditVerificationScheduler", () => {
  const originalWebhook = process.env.AUDIT_VERIFY_ALERT_WEBHOOK;
  const originalInterval = process.env.AUDIT_VERIFY_INTERVAL_MS;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stopAuditVerificationScheduler();
    delete process.env.AUDIT_VERIFY_ALERT_WEBHOOK;
    delete process.env.AUDIT_VERIFY_INTERVAL_MS;
    mocks.verifyAuditTrail.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    stopAuditVerificationScheduler();
    vi.useRealTimers();

    if (originalWebhook === undefined) {
      delete process.env.AUDIT_VERIFY_ALERT_WEBHOOK;
    } else {
      process.env.AUDIT_VERIFY_ALERT_WEBHOOK = originalWebhook;
    }
    if (originalInterval === undefined) {
      delete process.env.AUDIT_VERIFY_INTERVAL_MS;
    } else {
      process.env.AUDIT_VERIFY_INTERVAL_MS = originalInterval;
    }
  });

  describe("runAuditVerificationOnce", () => {
    it("returns ok:true when audit trail is intact", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: true });
      const result = await runAuditVerificationOnce();
      expect(result.ok).toBe(true);
      expect(result.checkedAt).toBeTruthy();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns ok:false and invalidIndex when tampering detected", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 42 });
      const result = await runAuditVerificationOnce();
      expect(result.ok).toBe(false);
      expect(result.invalidIndex).toBe(42);
    });

    it("logs info on success", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: true });
      await runAuditVerificationOnce();
      expect(mocks.loggerInfo).toHaveBeenCalled();
    });

    it("logs error on tampering", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 7 });
      await runAuditVerificationOnce();
      expect(mocks.loggerError).toHaveBeenCalled();
    });

    it("returns ok:false and logs error when verifyAuditTrail throws", async () => {
      mocks.verifyAuditTrail.mockRejectedValue(new Error("DB down"));
      const result = await runAuditVerificationOnce();
      expect(result.ok).toBe(false);
      expect(mocks.loggerError).toHaveBeenCalled();
    });

    it("increments totalRuns on each call", async () => {
      const before = getAuditVerificationStatus().totalRuns;
      await runAuditVerificationOnce();
      expect(getAuditVerificationStatus().totalRuns).toBe(before + 1);
    });

    it("updates lastResult after run", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: true });
      await runAuditVerificationOnce();
      expect(getAuditVerificationStatus().lastResult).not.toBeNull();
      expect(getAuditVerificationStatus().lastResult!.ok).toBe(true);
    });

    it("resets consecutiveFailures to 0 on success after failure", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 1 });
      await runAuditVerificationOnce();
      mocks.verifyAuditTrail.mockResolvedValue({ ok: true });
      await runAuditVerificationOnce();
      expect(getAuditVerificationStatus().consecutiveFailures).toBe(0);
    });

    it("increments consecutiveFailures on repeated failures", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 1 });
      await runAuditVerificationOnce();
      await runAuditVerificationOnce();
      expect(getAuditVerificationStatus().consecutiveFailures).toBeGreaterThanOrEqual(2);
    });
  });

  describe("alert webhook", () => {
    it("logs warn when webhook not configured and tampering detected", async () => {
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 3 });
      await runAuditVerificationOnce();
      expect(mocks.loggerWarn).toHaveBeenCalled();
    });

    it("POSTs to webhook URL when configured and tampering detected", async () => {
      process.env.AUDIT_VERIFY_ALERT_WEBHOOK = "https://alerts.example.com/hook";
      mocks.fetchFn.mockResolvedValue({ ok: true, status: 200 });
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 5 });

      await runAuditVerificationOnce();

      expect(mocks.fetchFn).toHaveBeenCalledWith(
        "https://alerts.example.com/hook",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("logs error when webhook POST fails", async () => {
      process.env.AUDIT_VERIFY_ALERT_WEBHOOK = "https://alerts.example.com/hook";
      mocks.fetchFn.mockResolvedValue({ ok: false, status: 500 });
      mocks.verifyAuditTrail.mockResolvedValue({ ok: false, invalidIndex: 5 });

      await runAuditVerificationOnce();

      expect(mocks.loggerError).toHaveBeenCalled();
    });
  });

  describe("startAuditVerificationScheduler / stop", () => {
    it("sets running to true after start", () => {
      startAuditVerificationScheduler();
      expect(getAuditVerificationStatus().running).toBe(true);
      stopAuditVerificationScheduler();
    });

    it("sets running to false after stop", () => {
      startAuditVerificationScheduler();
      expect(getAuditVerificationStatus().running).toBe(true);
      stopAuditVerificationScheduler();
      expect(getAuditVerificationStatus().running).toBe(false);
    });

    it("does not start twice if already running", () => {
      startAuditVerificationScheduler();
      const runsBefore = getAuditVerificationStatus().totalRuns;
      // Second call should log info and return without creating a new timer
      startAuditVerificationScheduler();
      expect(getAuditVerificationStatus().totalRuns).toBe(runsBefore);
      stopAuditVerificationScheduler();
    });
  });

  describe("getAuditVerificationStatus", () => {
    it("returns a snapshot with expected shape", () => {
      const status = getAuditVerificationStatus();
      expect(typeof status.running).toBe("boolean");
      expect(typeof status.intervalMs).toBe("number");
      expect(typeof status.totalRuns).toBe("number");
      expect(typeof status.consecutiveFailures).toBe("number");
    });
  });
});
