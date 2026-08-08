// packages/mps-data-governance/tests/GovernedWriteCapability.test.ts

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  auditCapability,
  CASE_GRAPH_WRITE,
  GOVERNED_WRITE_CAPABILITIES,
  POSTGIS_RAW_WRITE,
} from "../src/GovernedWriteCapability";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Frozen counts. These are debt, measured. Lowering one is progress and
 * requires editing this file, which is the point: the number cannot drift
 * quietly in either direction.
 */
const FROZEN_LEGACY = {
  "postgis.raw_write": 32,
  "case_graph.write": 1,
} as const;

describe("governed write capabilities", () => {
  it("the repository root resolves, so an empty audit cannot pass vacuously", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "scripts"))).toBe(true);
  });

  describe.each(GOVERNED_WRITE_CAPABILITIES.map((c) => [c.id, c] as const))(
    "%s",
    (id, capability) => {
      const audit = auditCapability(REPO_ROOT, capability);

      it("has no unauthorised holders", () => {
        // A holder that is neither the chokepoint nor already-known debt is a
        // new road around the chokepoint. Add the barrier, not the file.
        expect(audit.unauthorised).toEqual([]);
      });

      it("the chokepoint exists and actually holds the capability", () => {
        // Without this the rule could pass while pointing at nothing: an
        // authorised path that no longer exists, or that no longer performs the
        // write, would make the whole invariant decorative.
        for (const file of capability.authorised) {
          expect(fs.existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
          expect(audit.holders, file).toContain(file);
        }
      });

      it("carries no stale legacy entries", () => {
        // A legacy entry that no longer holds the capability has been fixed.
        // Leaving it listed would overstate the remaining debt and let a real
        // regression hide behind a name that is already permitted.
        expect(audit.stale).toEqual([]);
      });

      it("legacy debt has not grown", () => {
        expect(capability.legacy.length).toBe(
          FROZEN_LEGACY[id as keyof typeof FROZEN_LEGACY],
        );
      });
    },
  );

  it("REGRESSION: a new unauthorised holder is detected", () => {
    // The rule is only worth having if it fails. Rather than trusting that it
    // would, narrow the authorised set and confirm the previously-permitted
    // chokepoint is reported.
    const withoutLibrarian = {
      ...POSTGIS_RAW_WRITE,
      authorised: [] as readonly string[],
      legacy: POSTGIS_RAW_WRITE.legacy.filter(
        (f) => f !== "scripts/import/import-librarian-manifest.ts",
      ),
    };

    const audit = auditCapability(REPO_ROOT, withoutLibrarian);
    expect(audit.unauthorised).toContain("scripts/import/import-librarian-manifest.ts");
  });

  it("exemptions are declared with a reason, not silently applied", () => {
    for (const capability of GOVERNED_WRITE_CAPABILITIES) {
      for (const exemption of capability.exempt) {
        expect(exemption.reason.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("the case graph chokepoint is distinct from the PostGIS one", () => {
    // Two chokepoints, because governed state enters through two doors:
    // permanent geodata into PostGIS, and case rows into the decision layer.
    // Collapsing them would leave one door unwatched.
    expect(CASE_GRAPH_WRITE.authorised).not.toEqual(POSTGIS_RAW_WRITE.authorised);
  });
});
