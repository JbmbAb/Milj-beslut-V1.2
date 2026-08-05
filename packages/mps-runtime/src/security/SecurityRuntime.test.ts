import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmptyRuntimeState } from "../kernel/RuntimeState.js";
import { sha256ContentHash } from "../kernel/ExecutionKernel.js";
import { DEFAULT_ADMISSION_POLICY } from "../contracts/model/ExecutionPolicies.js";
import type { FrozenExecutionManifestIdentity } from "../contracts/freeze/FrozenIdentities.js";
import {
  SECURITY_RUNTIME_VERSION,
  SecurityRuntime,
  createHmacSigningKeyProvider,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkTs(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function sampleManifest(
  capabilityId = "cap-1",
): FrozenExecutionManifestIdentity {
  return {
    manifest_id: "m-sec-1",
    artifact_type: "execution_manifest",
    execution_identity_ref: {
      artifact_id: "id-1",
      artifact_type: "execution_identity",
    },
    capability_resolution_ref: {
      artifact_id: capabilityId,
      artifact_type: "CAPABILITY_DEFINITION",
    },
    parameters: {},
    content_hash: sha256ContentHash({ m: 1 }),
  };
}

describe("Security Runtime (Epoch II §2.9)", () => {
  it("exposes version and default policy forbids bypass", () => {
    expect(SECURITY_RUNTIME_VERSION).toBe("1.0.0");
    expect(DEFAULT_ADMISSION_POLICY.allow_bypass).toBe(false);
  });

  it("fail-closed: admit without principal is denied", async () => {
    const security = SecurityRuntime.create({
      bootstrapAdmit: true,
      grants: [{ principal_id: "actor-1", capability_id: "cap-1" }],
    });
    const result = await security.admit(
      sampleManifest(),
      createEmptyRuntimeState(),
    );
    expect(result.decision).toBe("denied");
    expect(result.reason_codes).toContain("NO_PRINCIPAL_BOUND");
  });

  it("fail-closed: admit without grant is denied", async () => {
    const security = SecurityRuntime.create({
      bootstrapAdmit: true,
      grants: [{ principal_id: "actor-1", capability_id: "other-cap" }],
    });
    security.bindPrincipal("actor-1");
    const result = await security.admit(
      sampleManifest("cap-1"),
      createEmptyRuntimeState(),
    );
    expect(result.decision).toBe("denied");
    expect(result.reason_codes).toContain("CAPABILITY_NOT_GRANTED");
  });

  it("happy path: principal + grant → admit + authorize + attest", async () => {
    const signer = createHmacSigningKeyProvider("test-secret-key-01");
    const security = SecurityRuntime.create({
      bootstrapAdmit: true,
      grants: [{ principal_id: "actor-1", capability_id: "cap-1" }],
      signer,
      bindSeed: "seed:sec",
    });
    security.bindPrincipal("actor-1");

    const admit = await security.admit(
      sampleManifest("cap-1"),
      createEmptyRuntimeState(),
    );
    expect(admit.decision).toBe("admitted");
    expect(admit.reason_codes).toContain("SECURITY_ADMIT");

    expect(security.authorizeInvoke("cap-1").decision).toBe("allow");
    expect(security.authorizeInvoke("cap-x").decision).toBe("deny");

    const outcome_hash = sha256ContentHash({ ok: true });
    const attestation = security.attestOutcome(outcome_hash);
    expect(attestation.principal_id).toBe("actor-1");
    expect(attestation.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(security.verifyAttestation(attestation)).toBe(true);
  });

  it("asAuthorizedExecutorPort blocks unggranted invoke", async () => {
    const security = SecurityRuntime.create({
      bootstrapAdmit: true,
      grants: [{ principal_id: "actor-1", capability_id: "cap-1" }],
    });
    security.bindPrincipal("actor-1");
    const port = security.asAuthorizedExecutorPort({
      execute: async () => {
        throw new Error("should not run");
      },
    });
    await expect(
      port.execute({
        capability_ref: {
          artifact_id: "cap-x",
          artifact_type: "CAPABILITY_DEFINITION",
        },
        input_refs: [],
        state: createEmptyRuntimeState(),
      }),
    ).rejects.toThrow(/Capability invoke denied/);
  });

  it("rejects AdmissionPolicy.allow_bypass without bootstrapAdmit", () => {
    expect(() =>
      SecurityRuntime.create({
        admissionPolicy: {
          ...DEFAULT_ADMISSION_POLICY,
          allow_bypass: true,
        },
      }),
    ).toThrow(/allow_bypass must be false/);
  });

  it("security module never imports domain / IAM packages", () => {
    const violations: string[] = [];
    for (const file of walkTs(__dirname)) {
      const src = readFileSync(file, "utf8");
      if (/from\s+['"][^'"]*mps-lu[^'"]*['"]/.test(src)) {
        violations.push(file);
      }
      if (/passport|oidc|oauth|BankID/i.test(src)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
