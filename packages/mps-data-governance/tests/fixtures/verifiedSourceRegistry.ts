import { isUrlAllowedForVerifiedSource } from "../../src/SourceRegistry";
import type { VerifiedSourceDefinition, VerifiedSourceRegistry } from "../../src/SourceRegistry";

/**
 * P2 test fixture — a VerifiedSourceRegistry built by hand.
 *
 * ⚠️ THIS IS A TEST FIXTURE AND NOT AN AUTHORITY. It bypasses `loadVerifiedSourceRegistry()`
 * and therefore performs no attestation verification. It exists so the adapter and transport
 * layers can be proven while the real registry artifact is being re-issued under GOVERNOR
 * authority.
 *
 * Nothing in production may construct a registry this way. The one place that matters — the
 * composition root — is deliberately not built yet, precisely so this shortcut cannot leak
 * into it.
 *
 * `isUrlAllowedForSource` delegates to the real `isUrlAllowedForVerifiedSource`, so scope
 * behaviour under test is the production rule and not a re-implementation.
 */
export function fixtureSource(
  overrides: Partial<VerifiedSourceDefinition> = {},
): VerifiedSourceDefinition {
  return {
    sourceId: "sgu-jordarter",
    authority: { name: "SGU", type: "other" },
    endpointUrl: "https://resource.sgu.se/service/wfs/130/jordarter",
    adapter: "wfs_v1",
    frequency: "monthly",
    allowedDomains: ["resource.sgu.se"],
    artifactTypes: ["geodata"],
    policy: {
      rate_limit_requests_per_second: 0,
      concurrency_limit: 2,
      politeness_delay_ms: 0,
      max_object_size_bytes: 1_000_000,
      retry_policy: { max_attempts: 2, backoff: "FIXED" },
    },
    registryArtifactId: "reg-sgu-001",
    sourceContentHash: "a".repeat(64),
    ...overrides,
  };
}

export function fixtureRegistry(
  ...sources: readonly VerifiedSourceDefinition[]
): VerifiedSourceRegistry {
  const all = sources.length > 0 ? sources : [fixtureSource()];
  return {
    registryPath: "<fixture>",
    sources: all,
    getSource: (id) => all.find((s) => s.sourceId === id) ?? null,
    isUrlAllowedForSource: (id, url) => {
      const source = all.find((s) => s.sourceId === id);
      return source ? isUrlAllowedForVerifiedSource(source, url) : false;
    },
  };
}
