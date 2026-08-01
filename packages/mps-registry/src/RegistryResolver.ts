import type { SchemaReference } from "@miljobeslut/mps-core";
import type { RegistryKind } from "./RegistryTypes";

export class RegistryResolver {
  resolveKind(schema_ref?: SchemaReference): RegistryKind {
    if (!schema_ref) {
      throw new Error("Cannot resolve registry kind: missing schema reference");
    }

    const id = schema_ref.schema_id.toLowerCase();

    if (id.includes("governance-profile")) {
      return "governance-profile";
    }
    if (id.includes("policy-set")) {
      return "policy-set";
    }
    if (id.includes("replay-profile")) {
      return "replay-profile";
    }
    if (id.includes("archive-profile")) {
      return "archive-profile";
    }
    if (id.includes("promotion-profile")) {
      return "promotion-profile";
    }

    throw new Error(`Unknown registry schema ID: ${schema_ref.schema_id}`);
  }
}
