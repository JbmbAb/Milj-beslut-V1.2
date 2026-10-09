import { describe, expect, it } from "vitest";

import {
  EnvironmentLantmaterietStacCredentialProvider,
  EnvironmentLantmaterietStacByggnaderCredentialProvider,
  LANTMATERIET_STAC_TOKEN_URL,
  LantmaterietStacByggnaderAssetTransport,
  assertByggnaderAssetUrl,
} from "../src/LantmaterietStacByggnaderAssetTransport";

const ASSET_URL = "https://dl1.lantmateriet.se/byggnadsverk/byggnad_kn2482.zip";
const TEST_TOKEN = "test-lm-building-token";

function transportFor(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  token = TEST_TOKEN,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call.url, call.init);
  }) as typeof fetch;

  return {
    calls,
    transport: new LantmaterietStacByggnaderAssetTransport({
      credentialProvider: { async getBearerToken() { return token; } },
      fetchImpl,
    }),
  };
}

describe("P2-LM-STAC-AUTH-TRANSPORT-01", () => {
  it("injects the runtime bearer only for an exact Lantmäteriet byggnader asset", async () => {
    const { transport, calls } = transportFor(() => new Response("zip-bytes", { status: 200 }));

    const response = await transport.get(ASSET_URL, { timeout_ms: 1_000 });

    expect(new TextDecoder().decode(response.bytes)).toBe("zip-bytes");
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${TEST_TOKEN}`);
    expect(new Headers(calls[0].init.headers).get("accept")).toBe("application/zip");
  });

  it("rejects every non-building URL before credential access or network I/O", async () => {
    let credentialRequests = 0;
    const fetchCalls: string[] = [];
    const transport = new LantmaterietStacByggnaderAssetTransport({
      credentialProvider: {
        async getBearerToken() {
          credentialRequests++;
          return TEST_TOKEN;
        },
      },
      fetchImpl: (async (url: string | URL) => {
        fetchCalls.push(String(url));
        return new Response("unexpected", { status: 200 });
      }) as typeof fetch,
    });

    await expect(
      transport.get("https://api.lantmateriet.se/stac-vektor/v1/collections/byggnader/items", { timeout_ms: 1_000 }),
    ).rejects.toThrow(/REJECT_AUTH_ASSET_SCOPE/);
    await expect(
      transport.get("https://dl1.lantmateriet.se/hydrografi/vatten_kn2482.zip", { timeout_ms: 1_000 }),
    ).rejects.toThrow(/REJECT_AUTH_ASSET_SCOPE/);

    expect(credentialRequests).toBe(0);
    expect(fetchCalls).toEqual([]);
  });

  it("rejects redirects after one authenticated request and never contacts the redirect target", async () => {
    const redirected = "https://other.example.invalid/asset.zip";
    const { transport, calls } = transportFor(() => new Response(null, {
      status: 302,
      headers: { location: redirected },
    }));

    await expect(transport.get(ASSET_URL, { timeout_ms: 1_000 })).rejects.toThrow(
      /REJECT_AUTHENTICATED_REDIRECT/,
    );

    expect(calls.map((call) => call.url)).toEqual([ASSET_URL]);
    expect(calls.some((call) => call.url === redirected)).toBe(false);
  });

  it("does not expose credential-provider failures or the bearer token in errors", async () => {
    const transport = new LantmaterietStacByggnaderAssetTransport({
      credentialProvider: {
        async getBearerToken() {
          throw new Error(`provider failure: ${TEST_TOKEN}`);
        },
      },
      fetchImpl: (async () => new Response("unexpected", { status: 200 })) as typeof fetch,
    });

    await expect(transport.get(ASSET_URL, { timeout_ms: 1_000 })).rejects.toThrow(
      /REJECT_CREDENTIAL_UNAVAILABLE/,
    );
    await transport.get(ASSET_URL, { timeout_ms: 1_000 }).catch((error: unknown) => {
      expect(String(error)).not.toContain(TEST_TOKEN);
    });
  });

  it("fails closed when the runtime-only bearer value is absent", async () => {
    const provider = new EnvironmentLantmaterietStacByggnaderCredentialProvider({});
    const transport = new LantmaterietStacByggnaderAssetTransport({
      credentialProvider: provider,
      fetchImpl: (async () => new Response("unexpected", { status: 200 })) as typeof fetch,
    });

    await expect(transport.get(ASSET_URL, { timeout_ms: 1_000 })).rejects.toThrow(
      /REJECT_CREDENTIAL_UNAVAILABLE/,
    );
  });

  it("uses the existing general pre-issued bearer contract when the legacy source variable is absent", async () => {
    const provider = new EnvironmentLantmaterietStacCredentialProvider({
      LANTMATERIET_ACCESS_TOKEN: TEST_TOKEN,
    });

    await expect(provider.getBearerToken()).resolves.toBe(TEST_TOKEN);
    expect(provider.authenticationMethod()).toBe("PREISSUED_BEARER");
  });

  it("obtains and caches a bearer through the official OAuth2 client-credentials endpoint", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
    const provider = new EnvironmentLantmaterietStacCredentialProvider(
      {
        LANTMATERIET_CONSUMER_KEY: "test-consumer-key",
        LANTMATERIET_CONSUMER_SECRET: "test-consumer-secret",
      },
      (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ access_token: TEST_TOKEN, expires_in: 3_600 }), { status: 200 });
      }) as typeof fetch,
      () => 1_000,
    );

    await expect(provider.getBearerToken()).resolves.toBe(TEST_TOKEN);
    await expect(provider.getBearerToken()).resolves.toBe(TEST_TOKEN);

    expect(provider.authenticationMethod()).toBe("OAUTH2_CLIENT_CREDENTIALS");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(LANTMATERIET_STAC_TOKEN_URL);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toMatch(/^Basic /);
    expect(new Headers(calls[0].init?.headers).get("authorization")).not.toContain(TEST_TOKEN);
  });

  it("rejects an OAuth token endpoint outside the official Lantmäteriet scope before network I/O", async () => {
    let calls = 0;
    const provider = new EnvironmentLantmaterietStacCredentialProvider(
      {
        LANTMATERIET_CONSUMER_KEY: "test-consumer-key",
        LANTMATERIET_CONSUMER_SECRET: "test-consumer-secret",
        LANTMATERIET_TOKEN_URL: "https://elsewhere.example.invalid/token",
      },
      (async () => {
        calls++;
        return new Response("unexpected", { status: 200 });
      }) as typeof fetch,
    );

    await expect(provider.getBearerToken()).rejects.toThrow(/outside the approved scope/);
    expect(calls).toBe(0);
  });

  it("enforces the configured object-size bound while streaming authenticated asset bytes", async () => {
    const { transport } = transportFor(() => new Response("12345", { status: 200 }));

    await expect(transport.get(ASSET_URL, { timeout_ms: 1_000, max_bytes: 4 })).rejects.toThrow(
      /REJECT_OBJECT_SIZE/,
    );
  });

  it("rejects insecure, credential-bearing, or malformed asset URLs", () => {
    expect(() => assertByggnaderAssetUrl("http://dl1.lantmateriet.se/byggnadsverk/byggnad_kn2482.zip"))
      .toThrow(/REJECT_AUTH_ASSET_SCOPE/);
    expect(() => assertByggnaderAssetUrl("https://token@dl1.lantmateriet.se/byggnadsverk/byggnad_kn2482.zip"))
      .toThrow(/REJECT_AUTH_ASSET_SCOPE/);
    expect(() => assertByggnaderAssetUrl("not a URL"))
      .toThrow(/REJECT_AUTH_ASSET_SCOPE/);
  });
});
