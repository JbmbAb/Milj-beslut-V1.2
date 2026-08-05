import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN = [
  "FileByteStorageBackend",
  "LU_MPS_CAS_DIR",
  ".data/mps-cas",
  "new FileCASRepository(",
] as const;

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTs(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Guard: product Execution Platform path must not use legacy parallel CAS
 * or construct Mimers FileCASRepository outside MimersIntegration.
 */
describe("No parallel mps-cas product path", () => {
  it("LuExecutionKernelClient uses MimersIntegration only", () => {
    const file = path.resolve(
      __dirname,
      "../../../mps-lu/src/execution/LuExecutionKernelClient.ts",
    );
    const src = readFileSync(file, "utf8");
    expect(src).toContain("MimersIntegration");
    expect(src).toContain("MimersIntegration.create");
    for (const token of FORBIDDEN) {
      expect(src).not.toContain(token);
    }
  });

  it("kernel + replay never construct FileCASRepository or legacy mps-cas", () => {
    const roots = [
      path.resolve(__dirname, "../kernel"),
      path.resolve(__dirname, "../replay"),
    ];
    const violations: string[] = [];
    for (const root of roots) {
      for (const file of walkTs(root)) {
        const src = readFileSync(file, "utf8");
        for (const token of FORBIDDEN) {
          if (src.includes(token)) {
            violations.push(`${path.relative(root, file)}:${token}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("only MimersIntegration constructs FileCASRepository in mps-runtime src", () => {
    const srcRoot = path.resolve(__dirname, "..");
    const violators: string[] = [];
    for (const file of walkTs(srcRoot)) {
      const rel = path.relative(srcRoot, file).replace(/\\/g, "/");
      if (rel === "mimers/MimersIntegration.ts") continue;
      const src = readFileSync(file, "utf8");
      if (src.includes("new FileCASRepository(")) {
        violators.push(rel);
      }
      if (src.includes("FileByteStorageBackend") || src.includes(".data/mps-cas")) {
        violators.push(rel);
      }
    }
    expect(violators).toEqual([]);
  });
});
