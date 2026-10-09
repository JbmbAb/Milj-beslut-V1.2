import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadLokeRuntimeEnvironment } from "../src/LokeRuntimeEnvironment";
import { EnvironmentLantmaterietStacCredentialProvider } from "../src/LantmaterietStacByggnaderAssetTransport";

describe("LOKE-RUNTIME-ENVIRONMENT-01", () => {
  it("imports only supported LM contracts from the primary worktree without overwriting process values", () => {
    const activeRoot = mkdtempSync(join(tmpdir(), "loke-active-"));
    const primaryRoot = mkdtempSync(join(tmpdir(), "loke-primary-"));
    writeFileSync(join(primaryRoot, ".env"), [
      "LANTMATERIET_CONSUMER_KEY=test-consumer-key",
      "LANTMATERIET_CONSUMER_SECRET=test-consumer-secret",
      "UNRELATED_RUNTIME_SETTING=must-not-be-imported",
    ].join("\n"), "utf8");
    const environment: NodeJS.ProcessEnv = {
      LANTMATERIET_TOKEN_URL: "https://api.lantmateriet.se/token",
    };

    const result = loadLokeRuntimeEnvironment({
      cwd: activeRoot,
      primaryWorktreeRoot: primaryRoot,
      environment,
    });

    expect(result.loadedFiles).toEqual([join(primaryRoot, ".env")]);
    expect(environment.UNRELATED_RUNTIME_SETTING).toBeUndefined();
    expect(environment.LANTMATERIET_TOKEN_URL).toBe("https://api.lantmateriet.se/token");
    expect(new EnvironmentLantmaterietStacCredentialProvider(environment).authenticationMethod())
      .toBe("OAUTH2_CLIENT_CREDENTIALS");
  });

  it("gives a current-worktree local override precedence over the primary worktree", () => {
    const activeRoot = mkdtempSync(join(tmpdir(), "loke-active-"));
    const primaryRoot = mkdtempSync(join(tmpdir(), "loke-primary-"));
    writeFileSync(join(activeRoot, ".env.local"), "LANTMATERIET_ACCESS_TOKEN=active-test-token\n", "utf8");
    writeFileSync(join(primaryRoot, ".env"), [
      "LANTMATERIET_CONSUMER_KEY=test-consumer-key",
      "LANTMATERIET_CONSUMER_SECRET=test-consumer-secret",
    ].join("\n"), "utf8");
    const environment: NodeJS.ProcessEnv = {};

    loadLokeRuntimeEnvironment({ cwd: activeRoot, primaryWorktreeRoot: primaryRoot, environment });

    expect(new EnvironmentLantmaterietStacCredentialProvider(environment).authenticationMethod())
      .toBe("PREISSUED_BEARER");
    expect(environment.LANTMATERIET_CONSUMER_KEY).toBe("test-consumer-key");
  });
});
