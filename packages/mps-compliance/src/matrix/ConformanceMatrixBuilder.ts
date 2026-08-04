import { ConformanceMatrixSnapshot } from "./ConformanceMatrixSnapshot";
import { ConformanceEntry } from "./ConformanceEntry";
import { ComplianceError } from "../errors/ComplianceError";
import { ConformanceMatrixIdentity } from "./ConformanceMatrixIdentity";

/**
 * Mutable builder.
 *
 * freeze() creates immutable matrix snapshot.
 */
export class ConformanceMatrixBuilder {
  private entries: ConformanceEntry[] = [];

  register(entry: ConformanceEntry): void {
    if (!entry.adr_id) {
      throw new ComplianceError(
        "ADR_ID_REQUIRED",
        "ADR identifier required"
      );
    }

    this.entries.push(entry);
  }

  freeze(identity: ConformanceMatrixIdentity, version: string)
  : ConformanceMatrixSnapshot {
    return new ConformanceMatrixSnapshot(identity, version, this.entries);
  }
}
