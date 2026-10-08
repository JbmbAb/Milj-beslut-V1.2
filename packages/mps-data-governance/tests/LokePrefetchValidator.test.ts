import { describe, expect, it } from "vitest";

import {
  DownloadTargetResolverRegistry,
  SingleEndpointTargetResolver,
  isDeclaredStrongEtagAuthority,
} from "../src/DownloadTargetResolvers";
import { decidePrefetch } from "../src/PrefetchValidator";
import {
  InMemoryValidatorBindingStore,
  type ValidatorBindingRecord,
  type ValidatorBindingStore,
} from "../src/ValidatorBindingStore";
import type { ConditionalValidatorExchange } from "../src/PrefetchValidator";
import { fixtureRegistry, fixtureSource } from "./fixtures/verifiedSourceRegistry";

const LOCATOR = "https://example.test/resource";
const TOKEN = '"etag-T"';
const NOW = "2026-10-06T12:00:00.000Z";

interface ExchangeCall {
  readonly method: "GET" | "HEAD";
  readonly locatorIdentity: string;
  readonly ifNoneMatch: string;
}

function binding(overrides: Partial<ValidatorBindingRecord> = {}): ValidatorBindingRecord {
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
    ...overrides,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "source-a",
    sourceContentHash: "hash-1",
    registryArtifactId: "reg-1",
    adapterId: "test_adapter_v1",
    strongEtagAuthority: null,
    changeDetectionStrategy: "ETAG" as const,
    locatorIdentity: LOCATOR,
    targetIdentity: `${LOCATOR}\nobject.bin`,
    fileName: "object.bin",
    fileNameDeclared: true,
    validatorClass: "STRONG_ETAG" as const,
    method: "HEAD" as const,
    performLiveExchange: true,
    localContentHash: "local-bytes",
    downloadManifestDigest: "manifest-digest",
    casHash: "cas-hash",
    quarantineHash: "quarantine-hash",
    sniffedEtag: TOKEN,
    ...overrides,
  };
}

function storeOf(records: readonly ValidatorBindingRecord[]): ValidatorBindingStore & {
  readonly touched: string[];
} {
  const touched: string[] = [];
  return {
    touched,
    async resolve(): Promise<readonly ValidatorBindingRecord[]> {
      return records;
    },
    async replace(): Promise<void> {
      throw new Error("replace is not part of the SKIP path");
    },
    async touchObservedAt(
      _sourceId: string,
      _locatorIdentity: string,
      _targetIdentity: string,
      observedAt: string,
    ): Promise<boolean> {
      touched.push(observedAt);
      return true;
    },
  };
}

function exchangeOf(
  response: {
    readonly finalUrl?: string;
    readonly status: number;
    readonly etag: string | null;
    readonly body?: Uint8Array;
    readonly failure?: "unavailable" | "unauthorized" | "scope";
  },
  calls: ExchangeCall[],
): ConditionalValidatorExchange {
  return {
    async exchange(input) {
      calls.push(input);
      return {
        finalUrl: response.finalUrl ?? input.locatorIdentity,
        status: response.status,
        etag: response.etag,
        body: response.body,
        failure: response.failure,
      };
    },
  };
}

async function issuedTarget(declares: boolean, fileName = "object.bin") {
  const source = fixtureSource({
    sourceId: "source-a",
    sourceContentHash: "hash-1",
    registryArtifactId: "reg-1",
    adapter: "test_adapter_v1",
    endpointUrl: LOCATOR,
    allowedDomains: ["example.test"],
  });
  const resolver = {
    ...(declares ? { strongEtagCapabilityDeclaration: "STRONG_ETAG" as const } : {}),
    async resolve() {
      return {
        kind: "TARGETS" as const,
        targets: [{
          url: LOCATOR,
          file_name: fileName,
          targetIdentity: "caller-invented",
          source_metadata: { strong_etag: "true", etag: TOKEN },
        }],
      };
    },
  };
  const plan = await new DownloadTargetResolverRegistry(fixtureRegistry(source), {
    test_adapter_v1: resolver,
  }).resolve({ source_id: source.sourceId, execution_id: "exec-auth" });
  if (plan.kind !== "TARGETS") throw new Error("expected targets");
  const target = plan.targets[0];
  if (target === undefined) throw new Error("expected a target");
  return { source, target };
}

async function run(
  records: readonly ValidatorBindingRecord[],
  response: {
    readonly finalUrl?: string;
    readonly status: number;
    readonly etag: string | null;
    readonly body?: Uint8Array;
    readonly failure?: "unavailable" | "unauthorized" | "scope";
  } | null,
  overrides: Record<string, unknown> = {},
) {
  const calls: ExchangeCall[] = [];
  const store = storeOf(records);
  const issued = await issuedTarget(true);
  const result = await decidePrefetch(
    request({
      strongEtagAuthority: issued.target.strongEtagAuthority,
      adapterId: issued.source.adapter,
      ...overrides,
    }),
    store,
    response === null ? null : exchangeOf(response, calls),
    () => NOW,
  );
  return { result, calls, store };
}

describe("L-V0-PREFETCH-VALIDATOR-IMPL-01", () => {
  it("TV-S1 live 304 echoing the single bound strong ETag is SKIP", async () => {
    const { result, calls, store } = await run([binding()], { status: 304, etag: TOKEN });

    expect(result.decision).toBe("SKIP");
    expect(result.reasonCode).toBe("REMOTE_REPRESENTATION_UNCHANGED");
    expect(calls).toEqual([
      { method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN },
    ]);
    expect(store.touched).toEqual([NOW]);
    expect("contentBytes" in result).toBe(false);
  });

  it("TV-F1 no prior binding is FETCH / NO_PRIOR_BOUND_TOKEN", async () => {
    const { result, calls } = await run([], { status: 304, etag: TOKEN });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("NO_PRIOR_BOUND_TOKEN");
    expect(calls).toEqual([]);
  });

  it("TV-F2 more than one binding is FETCH / SIGNAL_UNVERIFIABLE", async () => {
    const { result, calls } = await run(
      [binding(), binding({ validatorToken: '"etag-U"' })],
      { status: 304, etag: TOKEN },
    );

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_UNVERIFIABLE");
    expect(calls).toEqual([]);
  });

  it("TV-F3 weak ETag is FETCH", async () => {
    const { result, calls } = await run(
      [binding({ validatorToken: 'W/"etag-T"' })],
      { status: 304, etag: 'W/"etag-T"' },
    );

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_UNVERIFIABLE");
    expect(calls).toEqual([]);
  });

  it("TV-F4 missing STRONG_ETAG capability is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagAuthority: null,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_CLASS_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  it("TV-F5 naked 304 without ETag is FETCH", async () => {
    const { result } = await run([binding()], { status: 304, etag: null });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_MISSING");
  });

  it("TV-F6 304 with a different ETag is FETCH", async () => {
    const { result } = await run([binding()], { status: 304, etag: '"etag-U"' });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_UNVERIFIABLE");
  });

  it("TV-F7 a token list is FETCH / SIGNAL_UNVERIFIABLE and is not sent", async () => {
    const { result, calls } = await run(
      [binding({ validatorToken: '"etag-T", "etag-U"' })],
      { status: 304, etag: TOKEN },
    );

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_UNVERIFIABLE");
    expect(calls).toEqual([]);
  });

  it("TV-F8 source_content_hash mismatch is FETCH / BINDING_MISMATCH", async () => {
    const { result, calls } = await run([binding({ sourceContentHash: "hash-2" })], {
      status: 304,
      etag: TOKEN,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("BINDING_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("TV-F9 registry artifact mismatch is FETCH / BINDING_MISMATCH", async () => {
    const { result, calls } = await run([binding({ registryArtifactId: "reg-2" })], {
      status: 304,
      etag: TOKEN,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("BINDING_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("TV-F10 final URL other than locator_identity is FETCH / BINDING_MISMATCH", async () => {
    const { result } = await run([binding()], {
      status: 304,
      etag: TOKEN,
      finalUrl: "https://example.test/other",
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("BINDING_MISMATCH");
  });

  it("TV-F11 changed adapter file_name is FETCH / BINDING_MISMATCH", async () => {
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      fileName: "renamed.bin",
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("BINDING_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("upstream unavailable is FETCH and does not SKIP", async () => {
    const { result } = await run([binding()], {
      status: 0,
      etag: null,
      failure: "unavailable",
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("reserved digest and revision classes are FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const digest = await run([binding({ validatorClass: "UPSTREAM_CONTENT_DIGEST" })], {
      status: 304,
      etag: TOKEN,
    }, { validatorClass: "UPSTREAM_CONTENT_DIGEST" });
    const revision = await run([binding({ validatorClass: "IMMUTABLE_REVISION_ID" })], {
      status: 304,
      etag: TOKEN,
    }, { validatorClass: "IMMUTABLE_REVISION_ID" });

    expect(digest.result).toMatchObject({
      decision: "FETCH",
      reasonCode: "SIGNAL_CLASS_FORBIDDEN",
    });
    expect(revision.result).toMatchObject({
      decision: "FETCH",
      reasonCode: "SIGNAL_CLASS_FORBIDDEN",
    });
    expect(digest.calls).toEqual([]);
    expect(revision.calls).toEqual([]);
  });

  it("local manifest, CAS and content hashes cannot produce SKIP without a live exchange", async () => {
    const { result, calls } = await run([binding()], null, { performLiveExchange: false });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("VALIDATOR_EXCHANGE_UNSUPPORTED");
    expect(calls).toEqual([]);
  });

  it("a differing local hash does not turn a valid 304 into FETCH", async () => {
    const { result } = await run([binding()], { status: 304, etag: TOKEN }, {
      localContentHash: "different-local-hash",
      downloadManifestDigest: "different-manifest",
      casHash: "different-cas",
      quarantineHash: "different-quarantine",
    });

    expect(result.decision).toBe("SKIP");
  });

  it("an old binding without a live exchange is FETCH", async () => {
    const { result } = await run([binding()], { status: 304, etag: TOKEN }, {
      performLiveExchange: false,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("VALIDATOR_EXCHANGE_UNSUPPORTED");
  });

  it("change_detection strategy ETAG without capability does not SKIP", async () => {
    const { result } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagAuthority: null,
      changeDetectionStrategy: "ETAG",
    });

    expect(result).toMatchObject({
      decision: "FETCH",
      reasonCode: "SIGNAL_CLASS_FORBIDDEN",
    });
  });

  it("a content-bearing conditional GET is FETCH and the decision carries no bytes", async () => {
    const body = new Uint8Array([1, 2, 3]);
    const { result } = await run([binding()], { status: 200, etag: '"etag-U"', body });

    expect(result).toEqual({
      decision: "FETCH",
      reasonCode: "REPRESENTATION_CHANGED",
    });
  });

  it("failed observed_at update cancels SKIP", async () => {
    const calls: ExchangeCall[] = [];
    const store: ValidatorBindingStore = {
      async resolve() {
        return [binding()];
      },
      async replace() {
        return undefined;
      },
      async touchObservedAt() {
        return false;
      },
    };
    const issued = await issuedTarget(true);
    const result = await decidePrefetch(
      request({
        strongEtagAuthority: issued.target.strongEtagAuthority,
        adapterId: issued.source.adapter,
      }),
      store,
      exchangeOf({ status: 304, etag: TOKEN }, calls),
      () => NOW,
    );

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_UNVERIFIABLE");
  });

  it("TV-T1 a different targetIdentity does not SKIP", async () => {
    const other = await issuedTarget(true, "other.bin");
    const { result, calls } = await run(
      [binding()],
      { status: 304, etag: TOKEN },
      {
        targetIdentity: other.target.targetIdentity,
        strongEtagAuthority: other.target.strongEtagAuthority,
        fileName: "object.bin",
      },
    );

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("BINDING_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("two distinct target identities on the same source and locator do not collapse into one store key", async () => {
    const store = new InMemoryValidatorBindingStore();
    await store.replace(binding({ targetIdentity: "target-a", validatorToken: '"etag-A"' }));
    await store.replace(binding({ targetIdentity: "target-b", validatorToken: '"etag-B"' }));

    const targetA = await store.resolve("source-a", LOCATOR, "target-a");
    const targetB = await store.resolve("source-a", LOCATOR, "target-b");

    expect(targetA.map((record) => record.validatorToken)).toEqual(['"etag-A"']);
    expect(targetB.map((record) => record.validatorToken)).toEqual(['"etag-B"']);

    const touched = await store.touchObservedAt(
      "source-a",
      LOCATOR,
      "target-a",
      "2026-10-06T13:00:00.000Z",
    );
    expect(touched).toBe(true);
    const afterA = await store.resolve("source-a", LOCATOR, "target-a");
    const afterB = await store.resolve("source-a", LOCATOR, "target-b");
    expect(afterA[0]?.observedAt).toBe("2026-10-06T13:00:00.000Z");
    expect(afterB[0]?.observedAt).toBe("2020-01-01T00:00:00.000Z");
    expect(afterB[0]?.validatorToken).toBe('"etag-B"');
  });

  it("the recall store keeps one token and does not mint a content hash", async () => {
    const store = new InMemoryValidatorBindingStore();
    await store.replace(binding());
    await store.replace(binding({ validatorToken: '"etag-U"', observedAt: NOW }));

    const sameTarget = `${LOCATOR}\nobject.bin`;
    const resolved = await store.resolve("source-a", LOCATOR, sameTarget);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.validatorToken).toBe('"etag-U"');
    expect(JSON.stringify(resolved[0])).not.toContain("contentHash");

    const touched = await store.touchObservedAt(
      "source-a",
      LOCATOR,
      sameTarget,
      "2026-10-06T13:00:00.000Z",
    );
    expect(touched).toBe(true);
    const after = await store.resolve("source-a", LOCATOR, sameTarget);
    expect(after[0]?.observedAt).toBe("2026-10-06T13:00:00.000Z");
    expect(after[0]?.validatorToken).toBe('"etag-U"');
  });
});

describe("L-V0-STRONG-ETAG-AUTHORITY-IMPL-01", () => {
  it("a registry-selected declaring resolver mints authority and one targetIdentity", async () => {
    const { source, target } = await issuedTarget(true);

    expect(target.targetIdentity).toBe(`${LOCATOR}\nobject.bin`);
    expect(target.targetIdentity).not.toBe("caller-invented");
    expect(target.strongEtagAuthority).toMatchObject({
      sourceId: source.sourceId,
      sourceContentHash: source.sourceContentHash,
      registryArtifactId: source.registryArtifactId,
      adapterId: source.adapter,
      locatorIdentity: LOCATOR,
      targetIdentity: `${LOCATOR}\nobject.bin`,
    });
  });

  it("source_metadata does not mint authority", async () => {
    const { target } = await issuedTarget(false);

    expect(target.strongEtagAuthority).toBeNull();
    expect(target.targetIdentity).toBe(`${target.url}\n${target.file_name}`);
  });

  it("a production resolver selected by the registry does not mint authority", async () => {
    const source = fixtureSource({
      adapter: "SINGLE_ENDPOINT_V1",
      endpointUrl: LOCATOR,
      allowedDomains: ["example.test"],
    });
    const plan = await new DownloadTargetResolverRegistry(fixtureRegistry(source), {
      SINGLE_ENDPOINT_V1: new SingleEndpointTargetResolver(),
    }).resolve({ source_id: source.sourceId, execution_id: "exec-prod" });
    if (plan.kind !== "TARGETS") throw new Error("expected targets");
    const target = plan.targets[0];

    expect(target?.strongEtagAuthority).toBeNull();
    expect(target?.targetIdentity).toBe(`${target?.url}\n${target?.file_name}`);
  });

  it("a caller boolean true cannot make capability eligible", async () => {
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagCapability: true,
      strongEtagAuthority: null,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_CLASS_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  it("a plain-object authority lookalike cannot make capability eligible", async () => {
    const lookalike = {
      sourceId: "source-a",
      sourceContentHash: "hash-1",
      registryArtifactId: "reg-1",
      adapterId: "test_adapter_v1",
      locatorIdentity: LOCATOR,
      targetIdentity: `${LOCATOR}\nobject.bin`,
    };
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagCapability: lookalike,
      strongEtagAuthority: lookalike,
      adapterId: lookalike.adapterId,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_CLASS_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  it("null authority is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagCapability: false,
      strongEtagAuthority: null,
    });

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_CLASS_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  it("change_detection strategy ETAG without minted authority is FETCH", async () => {
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagCapability: false,
      strongEtagAuthority: null,
      changeDetectionStrategy: "ETAG",
    });

    expect(result).toMatchObject({
      decision: "FETCH",
      reasonCode: "SIGNAL_CLASS_FORBIDDEN",
    });
    expect(calls).toEqual([]);
  });

  it("a conditional validator request cannot be GET", async () => {
    const { target } = await issuedTarget(true);
    const { result, calls } = await run([binding({ targetIdentity: `${LOCATOR}\nobject.bin` })], {
      status: 304,
      etag: TOKEN,
    }, {
      strongEtagCapability: true,
      strongEtagAuthority: target.strongEtagAuthority,
      adapterId: "test_adapter_v1",
      method: "GET",
      targetIdentity: `${LOCATOR}\nobject.bin`,
    });

    expect(calls).toEqual([]);
    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("VALIDATOR_EXCHANGE_UNSUPPORTED");
  });

  it("valid registry-issued authority and a HEAD 304 of the same ETag is SKIP", async () => {
    const { source, target } = await issuedTarget(true);
    const { result, calls } = await run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagCapability: false,
      strongEtagAuthority: target.strongEtagAuthority,
      adapterId: source.adapter,
      sourceId: source.sourceId,
      sourceContentHash: source.sourceContentHash,
      registryArtifactId: source.registryArtifactId,
      locatorIdentity: LOCATOR,
      targetIdentity: `${LOCATOR}\nobject.bin`,
      method: "HEAD",
    });

    expect(result.decision).toBe("SKIP");
    expect(result.reasonCode).toBe("REMOTE_REPRESENTATION_UNCHANGED");
    expect(calls).toEqual([
      { method: "HEAD", locatorIdentity: LOCATOR, ifNoneMatch: TOKEN },
    ]);
  });

  async function forbid(field: string, value: string) {
    const { source, target } = await issuedTarget(true);
    return run([binding()], { status: 304, etag: TOKEN }, {
      strongEtagCapability: true,
      strongEtagAuthority: target.strongEtagAuthority,
      adapterId: source.adapter,
      sourceId: source.sourceId,
      sourceContentHash: source.sourceContentHash,
      registryArtifactId: source.registryArtifactId,
      locatorIdentity: LOCATOR,
      targetIdentity: `${LOCATOR}\nobject.bin`,
      method: "HEAD",
      [field]: value,
    });
  }

  it("authority for another adapterId is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await forbid("adapterId", "other-adapter");

    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_CLASS_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  it("authority for another sourceContentHash is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await forbid("sourceContentHash", "hash-2");

    expect(result).toMatchObject({ decision: "FETCH", reasonCode: "SIGNAL_CLASS_FORBIDDEN" });
    expect(calls).toEqual([]);
  });

  it("authority for another registryArtifactId is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await forbid("registryArtifactId", "reg-2");

    expect(result).toMatchObject({ decision: "FETCH", reasonCode: "SIGNAL_CLASS_FORBIDDEN" });
    expect(calls).toEqual([]);
  });

  it("authority for another locatorIdentity is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await forbid("locatorIdentity", "https://example.test/other");

    expect(result).toMatchObject({ decision: "FETCH", reasonCode: "SIGNAL_CLASS_FORBIDDEN" });
    expect(calls).toEqual([]);
  });

  it("a caller-built second targetIdentity is FETCH / SIGNAL_CLASS_FORBIDDEN", async () => {
    const { result, calls } = await forbid("targetIdentity", "caller-second");

    expect(result).toMatchObject({ decision: "FETCH", reasonCode: "SIGNAL_CLASS_FORBIDDEN" });
    expect(calls).toEqual([]);
  });

  it("copying issuance symbols onto a new object does not forge authority", async () => {
    const { target } = await issuedTarget(true);
    const authority = target.strongEtagAuthority;
    expect(isDeclaredStrongEtagAuthority(authority)).toBe(true);
    const forged = {
      sourceId: "forged-source",
      sourceContentHash: "forged-hash",
      registryArtifactId: "forged-reg",
      adapterId: "forged-adapter",
      locatorIdentity: "https://forged.example/resource",
      targetIdentity: "forged-target",
    };
    for (const symbol of Object.getOwnPropertySymbols(authority)) {
      const descriptor = Object.getOwnPropertyDescriptor(authority, symbol);
      if (descriptor !== undefined) Object.defineProperty(forged, symbol, descriptor);
    }

    expect(isDeclaredStrongEtagAuthority(forged)).toBe(false);

    const { result, calls } = await run(
      [binding({
        sourceId: forged.sourceId,
        sourceContentHash: forged.sourceContentHash,
        registryArtifactId: forged.registryArtifactId,
        locatorIdentity: forged.locatorIdentity,
        targetIdentity: forged.targetIdentity,
      })],
      { status: 304, etag: TOKEN },
      {
        strongEtagAuthority: forged,
        sourceId: forged.sourceId,
        sourceContentHash: forged.sourceContentHash,
        registryArtifactId: forged.registryArtifactId,
        adapterId: forged.adapterId,
        locatorIdentity: forged.locatorIdentity,
        targetIdentity: forged.targetIdentity,
        method: "HEAD",
      },
    );
    expect(result.decision).toBe("FETCH");
    expect(result.reasonCode).toBe("SIGNAL_CLASS_FORBIDDEN");
    expect(calls).toEqual([]);
  });

  it("a spread clone of a legitimate authority is rejected", async () => {
    const { target } = await issuedTarget(true);
    const authority = target.strongEtagAuthority;
    expect(isDeclaredStrongEtagAuthority(authority)).toBe(true);
    expect(isDeclaredStrongEtagAuthority({ ...authority })).toBe(false);
  });

  it("a legitimate authority cannot be mutated", async () => {
    const { source, target } = await issuedTarget(true);
    const authority = target.strongEtagAuthority;
    if (!isDeclaredStrongEtagAuthority(authority)) throw new Error("expected issued authority");
    const original = { ...authority };
    const mutable = authority as {
      sourceId: string;
      sourceContentHash: string;
      registryArtifactId: string;
      adapterId: string;
      locatorIdentity: string;
      targetIdentity: string;
    };
    for (const field of [
      "sourceId",
      "sourceContentHash",
      "registryArtifactId",
      "adapterId",
      "locatorIdentity",
      "targetIdentity",
    ] as const) {
      expect(() => {
        mutable[field] = "mutated";
      }).toThrow(TypeError);
      expect(authority[field]).toBe(original[field]);
    }
    expect(authority.sourceId).toBe(source.sourceId);
    expect(isDeclaredStrongEtagAuthority(authority)).toBe(true);
  });
});
