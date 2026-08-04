export type DependencyViolationCode =
  | "FORBIDDEN_IMPORT_VIOLATION"
  | "PACKAGE_CYCLE_VIOLATION"
  | "CORE_EXPORT_BOUNDARY_VIOLATION"
  | "LAYER_ORDER_VIOLATION"
  | "PACKAGE_OWNERSHIP_VIOLATION"
  | "EXTERNAL_DEPENDENCY_VIOLATION";

export type ViolationSeverity =
  | "BLOCKING"      // Level A
  | "MERGE_BLOCK"   // Level B
  | "RELEASE_BLOCK"; // Level C (om ni vill använda det senare)

export interface DependencyViolation {
  code: DependencyViolationCode;
  severity: ViolationSeverity;
  package: string;
  file: string;
  dependency?: string;
  importPath?: string;
  message: string;
}

export interface DependencyAnalysisResult {
  forbiddenImports: DependencyViolation[];
  cycles: string[][];

  coreExportViolations: DependencyViolation[];
  layerOrderViolations: DependencyViolation[];
  ownershipViolations: DependencyViolation[];
  externalDependencyViolations: DependencyViolation[];
}
