import { ConformanceMatrixBuilder } from "./ConformanceMatrixBuilder";
import { ConformanceEntry } from "./ConformanceEntry";
import { RuleRegistrySnapshot } from "../conformance/RuleRegistrySnapshot";
import { createPackage24ActorTrustProfile } from "../profiles/Package24ActorTrustProfile";
import { createPackage24SignatureProfile } from "../profiles/Package24SignatureProfile";
import { createPackage24ExecutionProfile } from "../profiles/Package24ExecutionProfile";
import { createPackage24CapabilityProfile } from "../profiles/Package24CapabilityProfile";
import { createPackage24RetentionProfile } from "../profiles/Package24RetentionProfile";
import { createPackage24ReplayProfile } from "../profiles/Package24ReplayProfile";
import { ConformanceMatrixSnapshot } from "./ConformanceMatrixSnapshot";

export function createPackage24Mcs001Matrix(
  registry: RuleRegistrySnapshot
): ConformanceMatrixSnapshot {
  const builder = new ConformanceMatrixBuilder();

  const entries: ConformanceEntry[] = [
    {
      adr_id: "ADR-24-21",
      profile: createPackage24ActorTrustProfile(registry)
    },
    {
      adr_id: "ADR-24-22",
      profile: createPackage24SignatureProfile(registry)
    },
    {
      adr_id: "ADR-24-25",
      profile: createPackage24ExecutionProfile(registry)
    },
    {
      adr_id: "ADR-24-26",
      profile: createPackage24CapabilityProfile(registry)
    },
    {
      adr_id: "ADR-24-24",
      profile: createPackage24RetentionProfile(registry)
    },
    {
      adr_id: "ADR-24-23",
      profile: createPackage24ReplayProfile(registry)
    }
  ];

  for (const entry of entries) {
    builder.register(entry);
  }

  return builder.freeze("1.0");
}
