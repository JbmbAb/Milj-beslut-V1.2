import { describe, expect, it } from "vitest";

import {
  EnvironmentLantmaterietStacByggnaderCredentialProvider,
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
