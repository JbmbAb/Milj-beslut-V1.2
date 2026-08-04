import { DependencyGraph } from "./ImportGraph.js";
import {
  DependencyAnalysisResult,
  DependencyViolation,
  DependencyViolationCode,
  ViolationSeverity,
} from "./DependencyViolation.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rulesPath = resolve(__dirname, "../../dependency-rules/package24-boundaries.json");
const rules = JSON.parse(readFileSync(rulesPath, "utf-8"));

type LayerRules = {
  [packageName: string]: {
    canImport: string[];
  };
};

type OwnershipRules = {
  [packageName: string]: string[];
};

type ExternalDependencyRules = {
  [packageName: string]: string[];
};

const layerRules: LayerRules = rules.layers;
const ownershipRules: OwnershipRules = rules.ownership ?? {};
const externalRules: ExternalDependencyRules = rules.externalDependencies ?? {};

export function buildDependencyGraph(): DependencyGraph {
  return {
    nodes: [],
    edges: [],
  };
}

function violation(
  code: DependencyViolationCode,
  severity: ViolationSeverity,
  pkg: string,
  file: string,
  dependency: string | undefined,
  importPath: string | undefined,
  message: string
): DependencyViolation {
  return { code, severity, package: pkg, file, dependency, importPath, message };
}

export function analyzeDependencies(
  graph: DependencyGraph = buildDependencyGraph()
): DependencyAnalysisResult {
  const forbiddenImports: DependencyViolation[] = [];
  const coreExportViolations: DependencyViolation[] = [];
  const layerOrderViolations: DependencyViolation[] = [];
  const ownershipViolations: DependencyViolation[] = [];
  const externalDependencyViolations: DependencyViolation[] = [];
  const cycles: string[][] = [];

  // DEP-001: Forbidden imports (BLOCKING)
  for (const edge of graph.edges) {
    const from = edge.from;
    const to = edge.to;

    const allowed = layerRules[from]?.canImport ?? [];
    const isAllowed = allowed.includes(to);

    if (!isAllowed) {
      forbiddenImports.push(
        violation(
          "FORBIDDEN_IMPORT_VIOLATION",
          "BLOCKING",
          from,
          edge.file,
          to,
          edge.importPath,
          `Package "${from}" is not allowed to import "${to}".`
        )
      );
    }
  }

  // DEP-002: Cycles (BLOCKING) — TODO: implement cycle detection
  // cycles.push([...]);

  // DEP-003: Core export isolation (BLOCKING) — TODO: scan mps-core exports

  // DEP-004: Layer ordering (MERGE_BLOCK) — TODO: enforce preferred ordering if ni vill

  // DEP-005: Ownership (MERGE_BLOCK) — TODO: kontrollera att typer definieras i rätt paket

  // DEP-006: External dependency control (BLOCKING)
  // TODO: parse importPath for non-monorepo modules and compare with externalRules

  return {
    forbiddenImports,
    cycles,
    coreExportViolations,
    layerOrderViolations,
    ownershipViolations,
    externalDependencyViolations,
  };
}
