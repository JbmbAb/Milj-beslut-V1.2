// packages/mps-data-governance/tests/GovernedWriteCapability.test.ts

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  auditCapability,
  CASE_GRAPH_WRITE,
  GOVERNED_WRITE_CAPABILITIES,
  GOVERNED_WRITE_SCOPE,
  POSTGIS_RAW_WRITE,
} from "../src/GovernedWriteCapability";

const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Frozen counts. These are debt, measured. Lowering one is progress and
 * requires editing this file, which is the point: the number cannot drift
 * quietly in either direction.
 */
const FROZEN = {
  "postgis.raw_write": { legacy: 36, sessionOnly: 4 },
  "case_graph.write": { legacy: 1, sessionOnly: 0 },
} as const;

const temporaryRoots: string[] = [];

function syntheticRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "governed-write-"));
  temporaryRoots.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, contents, "utf8");
  }
  return root;
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

describe("governed write capabilities", () => {
  it("the repository root resolves, so an empty audit cannot pass vacuously", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "scripts"))).toBe(true);
  });

  it("every capability is policed over the same scope", () => {
    // Enforcement SHALL NOT depend on where the caller lives. Closing
    // script -> PostGIS while leaving service -> PostGIS open only moves the
    // road; the first version of this module did exactly that.
    for (const capability of GOVERNED_WRITE_CAPABILITIES) {
      expect(capability.scope, capability.id).toEqual(GOVERNED_WRITE_SCOPE);
    }
  });

  describe.each(GOVERNED_WRITE_CAPABILITIES.map((c) => [c.id, c] as const))(
    "%s",
    (id, capability) => {
      const audit = auditCapability(REPO_ROOT, capability);

      it("has no unauthorised holders", () => {
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

      it("carries no stale entries", () => {
        expect(audit.stale).toEqual([]);
      });

      it("session-only claims are true", () => {
        // A file listed as session-configuration only must contain no
        // data-modifying statement. Otherwise the label is a hiding place.
        expect(audit.falseSessionOnly).toEqual([]);
      });

      it("debt has not grown", () => {
        const frozen = FROZEN[id as keyof typeof FROZEN];
        expect(capability.legacy.length).toBe(frozen.legacy);
        expect(capability.sessionOnly.length).toBe(frozen.sessionOnly);
      });
    },
  );

  describe("bypass is rejected symmetrically", () => {
    it("a new raw-SQL writer under scripts is rejected", () => {
      const root = syntheticRepo({
        "scripts/import/rogue-harvest.ts":
          "await prisma.$executeRawUnsafe(`INSERT INTO env.layer (geom) VALUES (NULL)`);",
      });

      const audit = auditCapability(root, POSTGIS_RAW_WRITE);
      expect(audit.unauthorised).toEqual(["scripts/import/rogue-harvest.ts"]);
    });

    it("a new raw-SQL writer under server is rejected on the same terms", () => {
      // The point of the shared scope. A runtime service reaching prod directly
      // is the same violation as a script doing it, and must fail identically.
      const root = syntheticRepo({
        "server/modules/rogue/rogueService.ts":
          "await prisma.$executeRaw`INSERT INTO env.layer (geom) VALUES (NULL)`;",
      });

      const audit = auditCapability(root, POSTGIS_RAW_WRITE);
      expect(audit.unauthorised).toEqual(["server/modules/rogue/rogueService.ts"]);
    });

    it("a new case-graph writer is rejected wherever it lives", () => {
      const root = syntheticRepo({
        "scripts/rogue-binder.ts": "await prisma.environmentalCase.upsert({});",
        "server/services/rogueBinder.ts": "await prisma.caseEvidence.create({});",
      });

      const audit = auditCapability(root, CASE_GRAPH_WRITE);
      expect(audit.unauthorised).toEqual([
        "scripts/rogue-binder.ts",
        "server/services/rogueBinder.ts",
      ]);
    });

    it("a file claiming session-only status while writing is caught", () => {
      const root = syntheticRepo({
        "server/pretend.ts":
          "await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);\n" +
          "await tx.$executeRawUnsafe(`DELETE FROM env.layer`);",
      });

      const audit = auditCapability(root, {
        ...POSTGIS_RAW_WRITE,
        authorised: [],
        legacy: [],
        sessionOnly: ["server/pretend.ts"],
      });

      expect(audit.unauthorised).toEqual([]);
      expect(audit.falseSessionOnly).toEqual(["server/pretend.ts"]);
    });

    it("the exemption mechanism cannot be used silently", () => {
      for (const capability of GOVERNED_WRITE_CAPABILITIES) {
        for (const exemption of capability.exempt) {
          expect(exemption.reason.trim().length, exemption.path).toBeGreaterThan(0);
        }
      }
    });
  });

  it("the two chokepoints are distinct doors", () => {
    // Governed state enters through two doors: permanent geodata into PostGIS,
    // and case rows into the decision layer. Collapsing them would leave one
    // unwatched.
    expect(CASE_GRAPH_WRITE.authorised).not.toEqual(POSTGIS_RAW_WRITE.authorised);
  });
});
