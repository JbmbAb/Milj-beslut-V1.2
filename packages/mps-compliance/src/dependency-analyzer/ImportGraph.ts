export interface DependencyEdge {
  from: string;      // package name, e.g. "mps-application"
  to: string;        // package name, e.g. "mps-core"
  importPath: string; // raw import path, e.g. "mps-core/governance"
  file: string;      // full path to file where import occurs
}

export interface DependencyGraph {
  nodes: string[];      // package names
  edges: DependencyEdge[];
}
