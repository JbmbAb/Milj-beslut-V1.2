import { ConformanceMatrix } from "./ConformanceMatrix";
import { ConformanceEntry } from "./ConformanceEntry";
import { ConformanceMatrixIdentity } from "./ConformanceMatrixIdentity";

/**
 * Immutable MCS snapshot.
 *
 * Identity and content are inseparable.
 */
export class ConformanceMatrixSnapshot implements ConformanceMatrix {
  readonly identity: ConformanceMatrixIdentity;
  readonly version: string;
  readonly entries: readonly ConformanceEntry[];

  constructor(
    identity: ConformanceMatrixIdentity,
    version: string,
    entries: readonly ConformanceEntry[]
  ) {
    this.identity = Object.freeze(identity);

    this.version = version;

    this.entries = Object.freeze(
      entries.map(entry =>
        Object.freeze({
          adr_id: entry.adr_id,
          profile: entry.profile
        })
      )
    );
  }
}
