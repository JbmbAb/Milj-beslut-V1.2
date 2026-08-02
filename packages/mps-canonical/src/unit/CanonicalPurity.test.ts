import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DefaultCanonicalSerializer } from "../CanonicalSerializer.js";

describe("CanonicalPurity", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it("serializeCanonical MUST produce identical bytes regardless of TZ, LANG, or LC_ALL", () => {
        const serializer = new DefaultCanonicalSerializer();
        const date = new Date("2026-08-01T12:00:00Z"); // Fixerad tidpunkt i UTC

        // Test i UTC
        process.env.TZ = "UTC";
        process.env.LANG = "en_US.UTF-8";
        process.env.LC_ALL = "en_US.UTF-8";
        const bytesUTC = serializer.serializeCanonical({ time: date }, "CBOR");

        // Test i Stockholm med svensk locale
        process.env.TZ = "Europe/Stockholm";
        process.env.LANG = "sv_SE.UTF-8";
        process.env.LC_ALL = "sv_SE.UTF-8";
        const bytesSTHLM = serializer.serializeCanonical({ time: date }, "CBOR");

        // Test i Tokyo med japansk locale
        process.env.TZ = "Asia/Tokyo";
        process.env.LANG = "ja_JP.UTF-8";
        process.env.LC_ALL = "ja_JP.UTF-8";
        const bytesTOKYO = serializer.serializeCanonical({ time: date }, "CBOR");

        expect(bytesUTC).toEqual(bytesSTHLM);
        expect(bytesUTC).toEqual(bytesTOKYO);
    });
});
