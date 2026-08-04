import { ConformanceMatrixSnapshot } from "./ConformanceMatrixSnapshot";
import { ConformanceMatrixProjection } from "./ConformanceMatrixProjection";

export function createConformanceMatrixProjection(
  snapshot: ConformanceMatrixSnapshot
): ConformanceMatrixProjection {
  return {
    version: snapshot.version,
    entries: snapshot.entries.map(entry => {
      const profile = entry.profile;

      return {
        adr_id: entry.adr_id,
        profile_id: profile.profile_id,
        profile_version: profile.version,
        rule_ids: Object.freeze([...profile.rule_ids])
      };
    })
  };
}
