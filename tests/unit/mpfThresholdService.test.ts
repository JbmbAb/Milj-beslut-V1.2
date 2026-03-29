import { describe, expect, it } from "vitest";
import {
  evaluateMpfCode,
  getMpfGateDecision,
  getMpfThreshold,
  listMpfThresholds,
} from "../../server/services/mpfThresholdService";

describe("mpfThresholdService", () => {
  describe("listMpfThresholds", () => {
    it("returns a non-empty list of thresholds", () => {
      const thresholds = listMpfThresholds();
      expect(thresholds.length).toBeGreaterThan(0);
    });

    it("all thresholds have required fields", () => {
      for (const t of listMpfThresholds()) {
        expect(t.code).toBeTruthy();
        expect(["EWC", "SNI"]).toContain(t.codeType);
        expect(["A", "B", "C", "U"]).toContain(t.permitClass);
        expect(t.thresholdValue).toBeGreaterThan(0);
        expect(t.mpfReference).toBeTruthy();
      }
    });
  });

  describe("getMpfThreshold", () => {
    it("returns null for unknown code", () => {
      expect(getMpfThreshold("99 99 99")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(getMpfThreshold("")).toBeNull();
    });

    it("finds exact EWC code", () => {
      const result = getMpfThreshold("17 05 03*");
      expect(result).not.toBeNull();
      expect(result!.codeType).toBe("EWC");
      expect(result!.permitClass).toBe("A");
    });

    it("finds exact SNI code", () => {
      const result = getMpfThreshold("38.21");
      expect(result).not.toBeNull();
      expect(result!.codeType).toBe("SNI");
      expect(result!.permitClass).toBe("A");
    });

    it("case-insensitive match for EWC", () => {
      const result = getMpfThreshold("17 05 04");
      expect(result).not.toBeNull();
    });
  });

  describe("evaluateMpfCode", () => {
    it("returns UNKNOWN_CODE for unrecognised code", () => {
      const result = evaluateMpfCode({ code: "00 00 00", quantity: 100 });
      expect(result.gateDecision).toBe("UNKNOWN_CODE");
      expect(result.threshold).toBeNull();
      expect(result.permitClass).toBeNull();
    });

    it("returns PERMIT_REQUIRED when quantity exceeds class-A threshold", () => {
      // 17 05 03* has threshold 10 ton/år, class A
      const result = evaluateMpfCode({ code: "17 05 03*", quantity: 15 });
      expect(result.gateDecision).toBe("PERMIT_REQUIRED");
      expect(result.permitClass).toBe("A");
      expect(result.requiresEia).toBe(true);
    });

    it("returns EXEMPT when quantity is below threshold", () => {
      // 17 05 03* has threshold 10 ton/år
      const result = evaluateMpfCode({ code: "17 05 03*", quantity: 5 });
      expect(result.gateDecision).toBe("EXEMPT");
      expect(result.requiresEia).toBe(false);
    });

    it("returns PERMIT_REQUIRED for class-B when exceeding threshold", () => {
      // 17 05 04 has threshold 50000 ton/år, class B
      const result = evaluateMpfCode({ code: "17 05 04", quantity: 60000 });
      expect(result.gateDecision).toBe("PERMIT_REQUIRED");
      expect(result.permitClass).toBe("B");
    });

    it("returns NOTIFICATION_REQUIRED for class-C when exceeding threshold", () => {
      // 38.11 SNI has threshold 10000 ton/år, class C
      const result = evaluateMpfCode({ code: "38.11", quantity: 15000 });
      expect(result.gateDecision).toBe("NOTIFICATION_REQUIRED");
      expect(result.permitClass).toBe("C");
    });

    it("returns EXEMPT for class-C when below threshold", () => {
      const result = evaluateMpfCode({ code: "38.11", quantity: 500 });
      expect(result.gateDecision).toBe("EXEMPT");
    });

    it("sets requiresEia false for class-B permit", () => {
      const result = evaluateMpfCode({ code: "17 05 04", quantity: 60000 });
      expect(result.requiresEia).toBe(false);
    });

    it("returns correct quantity in result", () => {
      const result = evaluateMpfCode({ code: "17 05 03*", quantity: 7 });
      expect(result.quantityPerYear).toBe(7);
    });

    it("clamps negative quantity to 0", () => {
      const result = evaluateMpfCode({ code: "17 05 03*", quantity: -5 });
      expect(result.quantityPerYear).toBe(0);
      expect(result.gateDecision).toBe("EXEMPT");
    });
  });

  describe("getMpfGateDecision", () => {
    it("returns PERMIT_REQUIRED for class-A above threshold", () => {
      expect(getMpfGateDecision("17 05 03*", 20)).toBe("PERMIT_REQUIRED");
    });

    it("returns EXEMPT for class-A below threshold", () => {
      expect(getMpfGateDecision("17 05 03*", 1)).toBe("EXEMPT");
    });

    it("returns UNKNOWN_CODE for unknown code", () => {
      expect(getMpfGateDecision("XX 00 00", 100)).toBe("UNKNOWN_CODE");
    });
  });
});
