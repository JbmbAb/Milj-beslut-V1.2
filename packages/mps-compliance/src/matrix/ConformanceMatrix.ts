import { ConformanceEntry } from "./ConformanceEntry";
import { ConformanceMatrixIdentity } from "./ConformanceMatrixIdentity";

/**
 * Immutable MCS-001 conformance matrix.
 *
 * Represents a uniquely identified
 * compliance state.
 */
export interface ConformanceMatrix {
  readonly identity: ConformanceMatrixIdentity;
  readonly version: string;
  readonly entries: readonly ConformanceEntry[];
}
