import { describe, expect, it } from "vitest";

import {
  classifyDataportalDistribution,
  matchDataportalRecordToRegistry,
  parseDataportalSearchResponse,
} from "../src/DataportalDiscovery";
import type { VerifiedSourceRegistry } from "../src/SourceRegistry";

const SOURCE = {
  sourceId: "approved-atom-source",
  authority: { name: "Example Authority", type: "other" as const },
  endpointUrl: "https://authority.example.test/metadata/42",
  adapter: "LST_ISO_ATOM_ZIP_V1",
  frequency: "weekly" as const,
  allowedDomains: ["authority.example.test"],
  artifactTypes: ["dataset"],
  policy: { rate_limit_requests_per_second: 1, concurrency_limit: 1, retry_policy: { max_attempts: 1, backoff: "FIXED" as const } },
  registryArtifactId: "reg-42",
  sourceContentHash: "a".repeat(64),
};
const registry: VerifiedSourceRegistry = {
  registryPath: "fixture",
  sources: [SOURCE],
  getSource: (id) => id === SOURCE.sourceId ? SOURCE : null,
  isUrlAllowedForSource: () => false,
};

function response(distributionUrl = SOURCE.endpointUrl) {
  return {
    resource: { children: [{ contextId: "1", entryId: "2", metadata: {
      "https://example.test/dataset/42": {
        "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": [{ type: "uri", value: "http://www.w3.org/ns/dcat#Dataset" }],
        "http://purl.org/dc/terms/identifier": [{ type: "literal", value: "dataset-42" }],
        "http://purl.org/dc/terms/title": [{ type: "literal", lang: "sv", value: "Testdata" }],
        "http://purl.org/dc/terms/publisher": [{ type: "uri", value: "https://example.test/publisher" }],
        "http://www.w3.org/ns/dcat#distribution": [{ type: "uri", value: "https://example.test/distribution/42" }],
      },
      "https://example.test/publisher": { "http://xmlns.com/foaf/0.1/name": [{ type: "literal", value: "Example Authority" }] },
      "https://example.test/distribution/42": {
        "http://www.w3.org/ns/dcat#accessURL": [{ type: "uri", value: distributionUrl }],
        "http://www.w3.org/ns/dcat#mediaType": [{ type: "literal", value: "application/vnd.iso.19139+xml" }],
      },
    }}] },
  };
}

describe("Dataportal discovery boundary", () => {
  it("extracts discovery metadata without granting authority and exact-matches only the verified endpoint", () => {
    const records = parseDataportalSearchResponse(response(), "2026-10-09T00:00:00.000Z", registry);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ discovery_provider: "SVERIGES_DATAPORTAL", discovery_record_id: "1/2", publisher: "Example Authority" });
    expect(records[0]?.distributions[0]).toMatchObject({ protocol: "ISO_ATOM", support: "SUPPORTED_NOW" });
    expect(matchDataportalRecordToRegistry(records[0]!, registry)).toMatchObject({ kind: "EXACT_EXISTING_SOURCE", source: { sourceId: SOURCE.sourceId } });
  });

  it("creates an unapproved candidate rather than treating a discovery URL as authority", () => {
    const records = parseDataportalSearchResponse(response("https://portal.example.test/redirect"), "2026-10-09T00:00:00.000Z", registry);
    const match = matchDataportalRecordToRegistry(records[0]!, registry);
    expect(records[0]?.distributions[0]?.support).toBe("UNSUPPORTED_ADAPTER");
    expect(match).toMatchObject({ kind: "CANDIDATE_NEW_SOURCE", candidate: { authority_status: "UNAPPROVED" } });
  });

  it("classifies protocols deterministically and fails unknown locators closed", () => {
    expect(classifyDataportalDistribution(["https://x.test/a.zip"], [])).toBe("HTTP_ZIP");
    expect(classifyDataportalDistribution(["https://x.test/?service=WFS"], [])).toBe("WFS");
    expect(classifyDataportalDistribution(["https://x.test/ogc/features/v1"], [])).toBe("OGC_API_FEATURES");
    expect(classifyDataportalDistribution(["urn:uuid:no-network"], [])).toBe("UNKNOWN");
  });

  it("does not parse a distribution resource as a dataset", () => {
    expect(parseDataportalSearchResponse({ resource: { children: [{ metadata: { "x": {} } }] } }, "2026-10-09T00:00:00.000Z", registry)).toEqual([]);
  });

  it("is idempotent for unchanged discovery metadata", () => {
    const first = parseDataportalSearchResponse(response(), "2026-10-09T00:00:00.000Z", registry)[0];
    const replay = parseDataportalSearchResponse(response(), "2026-10-09T00:00:00.000Z", registry)[0];
    expect(replay?.metadata_content_hash).toBe(first?.metadata_content_hash);
    expect(matchDataportalRecordToRegistry(replay!, registry)).toEqual(matchDataportalRecordToRegistry(first!, registry));
  });
});
