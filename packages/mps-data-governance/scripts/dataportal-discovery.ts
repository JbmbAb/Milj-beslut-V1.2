/**
 * Minimal Sveriges Dataportal discovery entrypoint.
 *
 * The portal is queried only for DCAT-AP-SE metadata.  This script never invokes a
 * download adapter, never writes source-registry records, and never holds an approval
 * capability.  A caller may pass an exact registry match to the existing governed
 * harvest CLI as a separate, explicit operation.
 *
 * Usage:
 *   SOURCE_REGISTRY_SIGNING_KEY_ID=... SOURCE_REGISTRY_SIGNING_PUBLIC_KEY_PEM=... \
 *     npx tsx packages/mps-data-governance/scripts/dataportal-discovery.ts "Brunnar"
 */
import {
  matchDataportalRecordToRegistry,
  parseDataportalSearchResponse,
} from "../src/DataportalDiscovery";
import { loadVerifiedSourceRegistry } from "../src/SourceRegistry";

const DATAPORTAL_SEARCH = "https://admin.dataportal.se/store/search";
const DATAPORTAL_ORIGIN = "https://admin.dataportal.se";

function queryForTitle(title: string): URL {
  const url = new URL(DATAPORTAL_SEARCH);
  url.searchParams.set("type", "solr");
  // This is the documented Dataset + public metadata filter. The term is a discovery filter,
  // not an authority assertion and is never used to choose an adapter.
  url.searchParams.set(
    "query",
    `title.sv:${title} AND rdfType:http\\:\\/\\/www.w3.org\\/ns\\/dcat#Dataset AND public:true`,
  );
  url.searchParams.set("limit", "10");
  url.searchParams.set("offset", "0");
  url.searchParams.set("sort", "modified desc");
  return url;
}

async function main(): Promise<void> {
  const title = process.argv.slice(2).join(" ").trim();
  if (!title) {
    console.error("Usage: dataportal-discovery.ts <Swedish title filter>");
    process.exitCode = 1;
    return;
  }

  const registry = await loadVerifiedSourceRegistry();
  const url = queryForTitle(title);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`DATAPORTAL_HTTP_STATUS: ${response.status} from ${url.origin}${url.pathname}`);
  const retrievedAt = new Date().toISOString();
  const search = await response.json() as {
    resource?: { children?: readonly { contextId?: string | number; entryId?: string | number }[] };
  };
  const children = search.resource?.children;
  if (!Array.isArray(children)) throw new Error("DATAPORTAL_INVALID_RESPONSE: search returned no resource.children.");
  // Search returns a dataset's own RDF/JSON only. Hydrate each bounded search hit through the
  // documented metadata resource so distributions and publishers are discovered from metadata,
  // rather than guessed from the search snippet.
  const hydrated = await Promise.all(children.map(async (child) => {
    if (child.contextId === undefined || child.entryId === undefined) {
      throw new Error("DATAPORTAL_INVALID_RESPONSE: search child lacks contextId or entryId.");
    }
    const metadataUrl = new URL(`/store/${child.contextId}/metadata/${child.entryId}`, DATAPORTAL_ORIGIN);
    metadataUrl.searchParams.set("recursive", "dcat");
    metadataUrl.searchParams.set("format", "application/rdf+json");
    const metadataResponse = await fetch(metadataUrl, { headers: { accept: "application/rdf+json" } });
    if (!metadataResponse.ok) throw new Error(`DATAPORTAL_METADATA_HTTP_STATUS: ${metadataResponse.status} for ${child.contextId}/${child.entryId}`);
    return { contextId: child.contextId, entryId: child.entryId, metadata: await metadataResponse.json() };
  }));
  const records = parseDataportalSearchResponse({ resource: { children: hydrated } }, retrievedAt, registry);
  console.log(JSON.stringify({
    discovery_provider: "SVERIGES_DATAPORTAL",
    search_url: url.toString(),
    retrieved_at: retrievedAt,
    records: records.map((record) => ({ record, registry_match: matchDataportalRecordToRegistry(record, registry) })),
  }, null, 2));
}

void main();
