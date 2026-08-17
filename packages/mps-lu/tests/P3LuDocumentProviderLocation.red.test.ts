import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * 🔴 DOCUMENT_PROVIDER_LOCATION_FAIL_CLOSED-01 — location authority (RED).
 *
 *   01C proved that no production path can mint a document class outside the governed
 *   classification chain. This unit makes sure that chain is not later applied to documents
 *   selected through a fabricated jurisdiction.
 *
 *   Two defects sit in one control flow in PostgisDocumentProvider:
 *
 *     .catch(() => [])                     collapses QUERY_FAILED into NO_MATCH
 *     res[0]?.kommunnamn || "Mora"         collapses both into RESOLVED("Mora")
 *
 *   so the whole chain reads:
 *
 *     database failure → empty array → fabricated municipality
 *       → document lookup against the wrong jurisdiction
 *
 *   DOCUMENT_PROVIDER_LOCATION_AUTHORITY_V1 (frozen):
 *     A municipality identity MUST originate from a successful governed location resolution.
 *     A query failure MUST NOT become empty-result semantics.
 *     A missing municipality MUST NOT receive a default.
 *     An unresolved municipality MUST NOT trigger a document query.
 *
 *   Replacing the fallback with a bare `res[0]?.kommunnamn` would not close this: `undefined` or
 *   an empty string would simply flow on and pick up an implicit fallback further down. The three
 *   states are modelled explicitly instead — a local type in the provider layer, not a platform
 *   abstraction.
 *
 *   ⚠️ THESE TESTS ARE EXPECTED TO FAIL until the resolution states land.
 */
describe("🔴 DOCUMENT_PROVIDER_LOCATION_FAIL_CLOSED-01 — location authority", () => {
  const LU_SRC = resolve(__dirname, "..", "src");
  const PROVIDER_SRC = join(LU_SRC, "providers", "PostgisDocumentProvider.ts");
  const PROVIDER_MOD = "../src/providers/PostgisDocumentProvider";

  const code = (p: string) =>
    (existsSync(p) ? readFileSync(p, "utf8") : "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  async function loadProvider(): Promise<Record<string, unknown>> {
    try {
      return (await import(PROVIDER_MOD)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`MISSING PROVIDER SURFACE: ${(error as Error).message}`);
    }
  }

  const GEOMETRY = { type: "Point", coordinates: [14.5, 60.6] } as unknown as never;

  /**
   * A database double.
   *
   * `documentQueries` records every document lookup, so "no document query was made" is an
   * assertion rather than an inference from an empty result.
   */
  function db(spatial: { rows?: { kommunnamn: string }[]; throws?: Error }) {
    const documentQueries: unknown[] = [];
    return {
      documentQueries,
      client: {
        $queryRawUnsafe: async () => {
          if (spatial.throws) throw spatial.throws;
          return spatial.rows ?? [];
        },
        documentRecord: {
          findMany: async (args: unknown) => {
            documentQueries.push(args);
            return [];
          },
        },
      },
    };
  }

  function provider(client: unknown, ctor: unknown) {
    return new (ctor as new (client: unknown) => {
      fetchDocumentsForGeometry(geometry: never): Promise<unknown[]>;
    })(client);
  }

  // ------------------------------------------------------------------ L1

  it("L1: a successful query with a row RESOLVES to that exact municipality", async () => {
    const { PostgisDocumentProvider } = await loadProvider();
    const { client, documentQueries } = db({ rows: [{ kommunnamn: "Karlstad" }] });

    await provider(client, PostgisDocumentProvider).fetchDocumentsForGeometry(GEOMETRY);

    expect(documentQueries).toHaveLength(1);
    expect(
      JSON.stringify(documentQueries[0]),
      "The resolved municipality — and only it — may reach the document lookup.",
    ).toContain("Karlstad");
  });

  // ------------------------------------------------------------------ L2

  it("L2: a successful query with NO row is UNRESOLVED and queries no documents", async () => {
    const { PostgisDocumentProvider } = await loadProvider();
    const { client, documentQueries } = db({ rows: [] });

    const documents = await provider(client, PostgisDocumentProvider).fetchDocumentsForGeometry(
      GEOMETRY,
    );

    expect(
      documentQueries,
      "An unresolved location must not select documents. Returning documents for a municipality " +
        "nobody resolved is worse than returning none: downstream cannot tell the difference.",
    ).toHaveLength(0);
    expect(documents).toEqual([]);
  });

  // ------------------------------------------------------------------ L3

  it("L3: a thrown query is RESOLUTION_FAILED — distinct from no match, and fails closed", async () => {
    const { PostgisDocumentProvider } = await loadProvider();
    const { client, documentQueries } = db({ throws: new Error("connection reset") });

    await expect(
      provider(client, PostgisDocumentProvider).fetchDocumentsForGeometry(GEOMETRY),
      "`.catch(() => [])` made a database failure indistinguishable from a geometry that " +
        "genuinely matches nothing. One is an error, the other is a finding.",
    ).rejects.toThrow(/RESOLUTION_FAILED|REJECT_LOCATION/);

    expect(documentQueries).toHaveLength(0);
  });

  // ------------------------------------------------------------------ L4

  it("L4: no literal municipality fallback exists in the provider", () => {
    const src = code(PROVIDER_SRC);

    expect(
      /["']Mora["']/.test(src),
      "A default municipality fabricates a jurisdiction. Documents would be selected for a place " +
        "the geometry never resolved to, and the governed classification chain would then be " +
        "applied to that wrong selection — correctly, which is what makes it dangerous.",
    ).toBe(false);

    expect(
      /\.catch\s*\(\s*\(\s*\)\s*=>\s*\[\s*\]\s*\)/.test(src),
      "Swallowing the error into an empty array is the first half of the collapse; the default " +
        "is only the second.",
    ).toBe(false);
  });

  // ------------------------------------------------------------------ L5

  it("L5: the three resolution states are modelled explicitly, not by nullability", async () => {
    const src = code(PROVIDER_SRC);
    const resolutionSrc = code(join(LU_SRC, "providers", "MunicipalityResolution.ts"));
    const combined = src + resolutionSrc;

    for (const state of ["RESOLVED", "UNRESOLVED", "RESOLUTION_FAILED"]) {
      expect(
        new RegExp(`["']${state}["']`).test(combined),
        `'${state}' is not representable. With only \`string | undefined\`, an empty string or a ` +
          "later `??` re-introduces the same fabrication further down the call path.",
      ).toBe(true);
    }
  });

  // ------------------------------------------------------------------ CONTROL

  it("CONTROL: the double is real — a resolved municipality does reach the query", async () => {
    const { PostgisDocumentProvider } = await loadProvider();

    // If the provider ignored the injected client entirely, L2 and L3 would pass vacuously by
    // never querying anything. This proves the injected client is the one actually used.
    const { client, documentQueries } = db({ rows: [{ kommunnamn: "Älvkarleby" }] });
    await provider(client, PostgisDocumentProvider).fetchDocumentsForGeometry(GEOMETRY);

    expect(
      documentQueries,
      "A test double that is never consulted would make every fail-closed assertion above " +
        "meaningless.",
    ).toHaveLength(1);
    expect(JSON.stringify(documentQueries[0])).toContain("Älvkarleby");
  });
});
