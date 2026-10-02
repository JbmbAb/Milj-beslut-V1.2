import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileCASRepository } from "@miljobeslut/mimers-brunn-core";
import { MimersByteStorageBackend } from "../repository/MimersByteStorageBackend.js";

/**
 * M1a-F1 (5) / U30 verification F8: concurrent put() of ONE artifact id.
 *
 * put() wrote the id->hash entry with write-then-rename, which REPLACES an existing entry. Two
 * consequences, both measured on this machine before the fix (16 concurrent puts, 5 rounds):
 *  - same bytes: rename onto an entry another writer had just created failed with EPERM on Windows
 *    (18-20 of 80 puts failed per run) although the artifact was stored correctly -- a spurious failure;
 *  - DIFFERENT bytes under the same id: every round, puts of BOTH contents reported success and the
 *    last rename decided what the id names -- a silent WORM violation.
 * The entry is now created exclusively (hard link, EEXIST instead of replace): a put of the same bytes
 * is idempotent, a put of other bytes fails with "WORM violation" and changes nothing.
 *
 * Real files in a fresh temp directory (never a real CAS root); each writer gets its own
 * FileCASRepository (like separate processes), and every read-back goes through a fresh one.
 */
describe("MimersByteStorageBackend: concurrent put() of one id", () => {
  let root: string;
  let casDir: string;
  let indexDir: string;

  const writer = () => new MimersByteStorageBackend(new FileCASRepository(casDir, { durabilityMode: "none" }), indexDir);

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), "mimers-concurrent-put-"));
    casDir = path.join(root, "cas");
    indexDir = path.join(casDir, "artifact-id-index");
    await new FileCASRepository(casDir, { durabilityMode: "none" }).initialize();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function describeFailure(reason: unknown): string {
    const e = reason as NodeJS.ErrnoException;
    return `${e?.code ?? ""}|${e?.syscall ?? ""}|${String(e?.message ?? reason).slice(0, 80)}`;
  }

  it("16 concurrent puts of the SAME bytes (5 rounds): every put succeeds, the artifact reads back, no temp file is left", async () => {
    const failures: string[] = [];
    for (let round = 0; round < 5; round += 1) {
      const id = `same-bytes-${round}`;
      const bytes = Buffer.from(JSON.stringify({ round, content: "same" }));
      const results = await Promise.allSettled(Array.from({ length: 16 }, () => writer().put(id, bytes)));
      for (const r of results) if (r.status === "rejected") failures.push(describeFailure(r.reason));
      expect(Buffer.from((await writer().get(id))!).equals(bytes)).toBe(true);
    }
    expect(failures).toEqual([]);
    expect(readdirSync(indexDir).filter((name) => !name.endsWith(".idx"))).toEqual([]);
    expect(readdirSync(indexDir)).toHaveLength(5);
  });

  it("8 + 8 concurrent puts of DIFFERENT bytes under one id (5 rounds): only the stored content ever reports success; the others fail with a WORM violation", async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = `different-bytes-${round}`;
      const x = Buffer.from(JSON.stringify({ round, content: "x" }));
      const y = Buffer.from(JSON.stringify({ round, content: "y" }));
      const inputs = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? x : y));
      const results = await Promise.allSettled(inputs.map((bytes) => writer().put(id, bytes)));
      const stored = Buffer.from((await writer().get(id))!);
      const succeeded = new Set(results.flatMap((r, i) => (r.status === "fulfilled" ? [inputs[i] === x ? "x" : "y"] : [])));
      const storedLabel = stored.equals(x) ? "x" : stored.equals(y) ? "y" : "neither";
      // never both: a caller whose bytes are not what the id names must not have been told "stored"
      expect({ round, succeeded: [...succeeded].sort() }).toEqual({ round, succeeded: [storedLabel] });
      for (const [i, r] of results.entries()) {
        if (r.status === "rejected") {
          expect(inputs[i]!.equals(stored)).toBe(false);
          expect((r.reason as Error).message).toBe(`WORM violation: ${id}`);
        }
      }
    }
    expect(readdirSync(indexDir).filter((name) => !name.endsWith(".idx"))).toEqual([]);
  });

  it("a later put of the same bytes is idempotent; of other bytes a WORM violation that leaves the entry unchanged", async () => {
    const bytes = Buffer.from('{"content":"first"}');
    await Promise.all(Array.from({ length: 8 }, () => writer().put("settled", bytes)));
    await expect(writer().put("settled", bytes)).resolves.toBeUndefined();
    await expect(writer().put("settled", Buffer.from('{"content":"second"}'))).rejects.toThrow("WORM violation: settled");
    expect(Buffer.from((await writer().get("settled"))!).equals(bytes)).toBe(true);
  });
});
