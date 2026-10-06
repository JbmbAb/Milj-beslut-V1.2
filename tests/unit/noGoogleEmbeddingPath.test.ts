/**
 * W-NO-GOOGLE-02A -- the legal embedding path is Google-free (RED first).
 *
 * Scoped on purpose to the embedding path: the production retrieval composition, the retrieval
 * route and everything either of them imports inside the repository. It does NOT replace the
 * repository-wide noGoogleRuntimeGuard (that stays red for 02B generation until 02B lands); it
 * proves that 02A removed Google from this path and cannot quietly return.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ENTRIES = [
  "server/modules/legal/retrieval/LegalRetrievalComposition.ts",
  "server/routes/legalRetrieval.routes.ts",
];

const FORBIDDEN_TEXT: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "GEMINI_API_KEY", re: /GEMINI_API_KEY/ },
  { id: "GOOGLE_API_KEY", re: /GOOGLE_API_KEY/ },
  { id: "GOOGLE_APPLICATION_CREDENTIALS", re: /GOOGLE_APPLICATION_CREDENTIALS/ },
  { id: "google genai sdk", re: /@google\/genai|@google-cloud\/|google-auth-library|googleapis/ },
  { id: "gemini embedding model id", re: /gemini-embedding|text-embedding-00\d/ },
  { id: "Gemini embedding provider", re: /GeminiEmbeddingProvider|createGeminiEmbeddingProvider/ },
  { id: "vertex", re: /vertexai|VertexAI|vertexEmbedding/i },
  { id: "generative language host", re: /generativelanguage/ },
];

/** A mock / synthetic vector source must not be able to stand in for the real provider. */
const FORBIDDEN_FALLBACK: RegExp = /generateDeterministicVector|createMockEmbedding|mockEmbedding|fakeEmbeddingProvider|hashEmbedding|syntheticVector/;

const EXTS = ["", ".ts", ".tsx", "/index.ts", ".mjs", ".js"];
const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function stripJsonComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "");
}

const tsconfig = JSON.parse(stripJsonComments(fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8")));
const PATHS: Record<string, string[]> = tsconfig.compilerOptions?.paths ?? {};

function resolveRelative(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const b of [base, base.replace(/\.js$/, "")]) {
    for (const ext of EXTS) {
      const candidate = b + ext;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function closure(entries: readonly string[]): { files: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = entries.map((e) => path.resolve(ROOT, e));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(text))) {
      const spec = (m[1] ?? m[2])!;
      if (spec.startsWith(".")) {
        const resolved = resolveRelative(file, spec);
        if (resolved) queue.push(resolved);
      } else if (PATHS[spec]?.[0]) {
        queue.push(path.resolve(ROOT, PATHS[spec]![0]!));
      } else {
        bare.add(spec);
      }
    }
  }
  const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
  return { files: [...seen].map(rel).sort(), bare: [...bare].sort() };
}

const GRAPH = closure(ENTRIES);

describe("legal embedding path: import closure of the production retrieval composition and route", () => {
  it("is non-trivial (the walker really followed the imports)", () => {
    expect(GRAPH.files.length).toBeGreaterThan(15);
    expect(GRAPH.files).toContain("server/modules/legal/retrieval/LegalRetrievalComposition.ts");
    expect(GRAPH.files).toContain("packages/mps-embedding-identity/src/EmbeddingIdentity.ts");
  });

  it("does not import GeminiEmbeddingProvider (the file no longer exists in the tree)", () => {
    expect(GRAPH.files.filter((f) => /Gemini/i.test(path.basename(f)))).toEqual([]);
    expect(fs.existsSync(path.join(ROOT, "server/modules/legal/retrieval/GeminiEmbeddingProvider.ts"))).toBe(false);
  });

  it("imports no Google package anywhere in the closure (no @google/genai, no @google-cloud/*)", () => {
    expect(GRAPH.bare.filter((s) => /^@google|^google-|googleapis/.test(s))).toEqual([]);
  });

  it.each(FORBIDDEN_TEXT)("no file in the closure contains $id", ({ re }) => {
    const hits = GRAPH.files.filter((f) => re.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });

  it("contains no mock / synthetic embedding fallback", () => {
    const hits = GRAPH.files.filter((f) => FORBIDDEN_FALLBACK.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(hits).toEqual([]);
  });

  it("the composition and the local provider are part of the closure (the replacement is really wired in)", () => {
    expect(GRAPH.files).toContain("server/modules/legal/retrieval/LocalEmbeddingProvider.ts");
    expect(GRAPH.files).toContain("server/modules/legal/retrieval/LocalEmbeddingPersistence.ts");
    expect(GRAPH.files).toContain("packages/mps-embedding-identity/src/LocalEmbeddingPipelines.ts");
  });
});

describe("no tracked file outside docs still depends on the removed Google embedding provider", () => {
  it("nothing imports GeminiEmbeddingProvider", () => {
    const files = execFileSync("git", ["ls-files", "--", "server", "scripts", "packages", "tests", "src"], { cwd: ROOT, encoding: "utf8" })
      .split(/\r?\n/)
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => f !== "tests/unit/noGoogleEmbeddingPath.test.ts");
    const importers = files.filter((f) => /from\s+['"][^'"]*GeminiEmbeddingProvider['"]/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(importers).toEqual([]);
  });
});
