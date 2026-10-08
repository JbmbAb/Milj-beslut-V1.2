import { describe, expect, it } from "vitest";

import { DownloadTargetResolverRegistry } from "../src/DownloadTargetResolvers";
import { HarvestExecutionStateMachine } from "../src/HarvestExecutionStateMachine";
import { decidePrefetch } from "../src/PrefetchValidator";
import type { ValidatorBindingRecord, ValidatorBindingStore } from "../src/ValidatorBindingStore";
import { fixtureRegistry, fixtureSource } from "./fixtures/verifiedSourceRegistry";

const LOCATOR = "https://example.test/resource";
const TOKEN = '"etag-T"';

function binding(): ValidatorBindingRecord {
  return {
    sourceId: "source-a",
    sourceContentHash: "hash-1",
    registryArtifactId: "reg-1",
    locatorIdentity: LOCATOR,
    targetIdentity: `${LOCATOR}\nobject.bin`,
    fileName: "object.bin",
    validatorClass: "STRONG_ETAG",
    validatorToken: TOKEN,
    observedAt: "2020-01-01T00:00:00.000Z",
  };
}

async function authority() {
  const source = fixtureSource({
    sourceId: "source-a",
    sourceContentHash: "hash-1",
    registryArtifactId: "reg-1",
    adapter: "test_adapter_v1",
    endpointUrl: LOCATOR,
    allowedDomains: ["example.test"],
  });
  const plan = await new DownloadTargetResolverRegistry(fixtureRegistry(source), {
    test_adapter_v1: {
      strongEtagCapabilityDeclaration: "STRONG_ETAG" as const,
      async resolve() {
        return {
          kind: "TARGETS" as const,
          targets: [{ url: LOCATOR, file_name: "object.bin" }],
        };
      },
    },
  }).resolve({ source_id: source.sourceId, execution_id: "exec-wire" });
  if (plan.kind !== "TARGETS") throw new Error("expected targets");
  return { source, target: plan.targets[0]! };
}

function store(): ValidatorBindingStore {
  return {
    async resolve() {
      return [binding()];
    },
    async replace() {
      throw new Error("replace is not part of this pin");
    },
    async touchObservedAt() {
      return true;
    },
  };
}

describe("L-V0-HEAD-WIRING-IMPL-01", () => {
  it("HW-F6 an unsupported exchange failure is FETCH before a 304 can SKIP", async () => {
    const { source, target } = await authority();
    const result = await decidePrefetch(
      {
        sourceId: source.sourceId,
        sourceContentHash: source.sourceContentHash,
        registryArtifactId: source.registryArtifactId,
        adapterId: source.adapter,
        strongEtagAuthority: target.strongEtagAuthority ?? null,
        locatorIdentity: LOCATOR,
        targetIdentity: `${LOCATOR}\nobject.bin`,
        fileName: "object.bin",
        fileNameDeclared: true,
        validatorClass: "STRONG_ETAG",
        method: "HEAD",
        performLiveExchange: true,
      },
      store(),
      {
        async exchange() {
          return {
            finalUrl: LOCATOR,
            status: 304,
            etag: TOKEN,
            failure: "unsupported",
          };
        },
      },
      () => "2026-10-07T00:00:00.000Z",
    );

    expect(result).toEqual({
      decision: "FETCH",
      reasonCode: "VALIDATOR_EXCHANGE_UNSUPPORTED",
    });
  });

  it("a thrown exchange stays UPSTREAM_UNAVAILABLE", async () => {
    const { source, target } = await authority();
    const result = await decidePrefetch(
      {
        sourceId: source.sourceId,
        sourceContentHash: source.sourceContentHash,
        registryArtifactId: source.registryArtifactId,
        adapterId: source.adapter,
        strongEtagAuthority: target.strongEtagAuthority ?? null,
        locatorIdentity: LOCATOR,
        targetIdentity: `${LOCATOR}\nobject.bin`,
        fileName: "object.bin",
        fileNameDeclared: true,
        validatorClass: "STRONG_ETAG",
        method: "HEAD",
        performLiveExchange: true,
      },
      store(),
      {
        async exchange() {
          throw new Error("timeout");
        },
      },
      () => "2026-10-07T00:00:00.000Z",
    );

    expect(result).toEqual({ decision: "FETCH", reasonCode: "UPSTREAM_UNAVAILABLE" });
  });

  it("HARVESTING can enter terminal PREFETCH_EVIDENCE_RECORDED", () => {
    expect(
      HarvestExecutionStateMachine.canTransition("HARVESTING", "PREFETCH_EVIDENCE_RECORDED"),
    ).toBe(true);
    expect(HarvestExecutionStateMachine.isTerminal("PREFETCH_EVIDENCE_RECORDED")).toBe(true);
    expect(HarvestExecutionStateMachine.canTransition("PREFETCH_EVIDENCE_RECORDED", "HARVESTED")).toBe(
      false,
    );
    expect(HarvestExecutionStateMachine.canTransition("PREFETCH_EVIDENCE_RECORDED", "VERIFYING")).toBe(
      false,
    );
  });
});
