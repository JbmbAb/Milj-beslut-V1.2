import { createHash } from "node:crypto";

import type { VerifiedSourceDefinition, VerifiedSourceRegistry } from "./SourceRegistry";

/**
 * Sveriges Dataportal is a discovery plane.  These types deliberately contain no
 * approval, admission, or canonical-content claim.  A returned locator is only a
 * publisher claim until it is matched to an already verified registry source.
 */
export const DATAPORTAL_DISCOVERY_PROVIDER = "SVERIGES_DATAPORTAL" as const;

export type DistributionProtocol =
  | "HTTP_FILE"
  | "HTTP_ZIP"
  | "ISO_ATOM"
  | "WFS"
  | "WMS"
  | "OGC_API_FEATURES"
  | "ARCGIS_REST"
  | "STAC"
  | "API_GENERIC"
  | "AUTH_REQUIRED"
  | "UNKNOWN";

export type DiscoverySupport = "SUPPORTED_NOW" | "UNSUPPORTED_ADAPTER" | "AUTH_REQUIRED" | "AMBIGUOUS" | "INVALID";
export type RegistryMatchKind = "EXACT_EXISTING_SOURCE" | "CANDIDATE_NEW_SOURCE" | "AMBIGUOUS_SOURCE" | "REJECT";

export interface DataportalDistribution {
  readonly distribution_id: string;
  readonly urls: readonly string[];
  readonly media_types: readonly string[];
  readonly protocol: DistributionProtocol;
  readonly support: DiscoverySupport;
}

export interface DataportalDiscoveryRecord {
  readonly discovery_provider: typeof DATAPORTAL_DISCOVERY_PROVIDER;
  readonly discovery_record_id: string;
  readonly dataset_identifier: string;
  readonly title?: string;
  readonly description?: string;
  readonly publisher?: string;
  readonly publisher_identifier?: string;
  readonly themes: readonly string[];
  readonly spatial_coverage?: string;
  readonly temporal_coverage?: string;
  readonly modified?: string;
  readonly license?: string;
  readonly landing_page?: string;
  readonly distributions: readonly DataportalDistribution[];
  readonly service_urls: readonly string[];
  readonly retrieved_at: string;
  /** Hash of the discovery metadata, never a hash of publisher bytes. */
  readonly metadata_content_hash: string;
}

export interface DataportalDiscoveryCandidate {
  readonly kind: "CANDIDATE_NEW_SOURCE";
  readonly discovery: DataportalDiscoveryRecord;
  readonly suggested_mimer_domain: string;
  readonly suggested_relevance: string;
  readonly authority_status: "UNAPPROVED";
}

export type RegistryMatch =
  | { readonly kind: "EXACT_EXISTING_SOURCE"; readonly source: VerifiedSourceDefinition; readonly distribution: DataportalDistribution }
  | { readonly kind: "CANDIDATE_NEW_SOURCE"; readonly candidate: DataportalDiscoveryCandidate }
  | { readonly kind: "AMBIGUOUS_SOURCE"; readonly source_ids: readonly string[] }
  | { readonly kind: "REJECT"; readonly reason: string };

type RdfValue = { readonly type?: string; readonly value?: string; readonly lang?: string };
type RdfSubject = Readonly<Record<string, readonly RdfValue[]>>;
type DataportalSearchChild = {
  readonly contextId?: string | number;
  readonly entryId?: string | number;
  readonly metadata?: Readonly<Record<string, RdfSubject>>;
};

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const DCAT_DATASET = "http://www.w3.org/ns/dcat#Dataset";
const DCAT_DISTRIBUTION = "http://www.w3.org/ns/dcat#distribution";
const DCAT_DOWNLOAD_URL = "http://www.w3.org/ns/dcat#downloadURL";
const DCAT_ACCESS_URL = "http://www.w3.org/ns/dcat#accessURL";
const DCAT_ACCESS_SERVICE = "http://www.w3.org/ns/dcat#accessService";
const DCAT_ENDPOINT_URL = "http://www.w3.org/ns/dcat#endpointURL";
const DCAT_MEDIA_TYPE = "http://www.w3.org/ns/dcat#mediaType";
const DCAT_THEME = "http://www.w3.org/ns/dcat#theme";
const DCT_IDENTIFIER = "http://purl.org/dc/terms/identifier";
const DCT_TITLE = "http://purl.org/dc/terms/title";
const DCT_DESCRIPTION = "http://purl.org/dc/terms/description";
const DCT_PUBLISHER = "http://purl.org/dc/terms/publisher";
const DCT_MODIFIED = "http://purl.org/dc/terms/modified";
const DCT_LICENSE = "http://purl.org/dc/terms/license";
const DCT_SPATIAL = "http://purl.org/dc/terms/spatial";
const DCT_TEMPORAL = "http://purl.org/dc/terms/temporal";
const DCAT_LANDING_PAGE = "http://www.w3.org/ns/dcat#landingPage";

function values(subject: RdfSubject | undefined, predicate: string): readonly string[] {
  return (subject?.[predicate] ?? []).flatMap((value) => typeof value.value === "string" ? [value.value] : []);
}

function first(subject: RdfSubject | undefined, predicate: string): string | undefined {
  return values(subject, predicate)[0];
}

function hasType(subject: RdfSubject): boolean {
  return values(subject, RDF_TYPE).includes(DCAT_DATASET);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

/** Deterministic classification only; it never chooses or activates an adapter. */
export function classifyDataportalDistribution(urls: readonly string[], mediaTypes: readonly string[]): DistributionProtocol {
  const haystack = [...urls, ...mediaTypes].join(" ").toLowerCase();
  if (/authorization|bearer|oauth|api[_ -]?key|login/.test(haystack)) return "AUTH_REQUIRED";
  if (/stac/.test(haystack)) return "STAC";
  if (/arcgis|featureserver|mapserver/.test(haystack)) return "ARCGIS_REST";
  if (/ogcapi|ogc-api|(?:api|ogc)\/features/.test(haystack)) return "OGC_API_FEATURES";
  if (/service=wfs|\bwfs\b/.test(haystack)) return "WFS";
  if (/service=wms|\bwms\b/.test(haystack)) return "WMS";
  if (/atom|iso[._ -]?191(?:15|39)|application\/atom\+xml/.test(haystack)) return "ISO_ATOM";
  if (/\.zip(?:$|[?#])|application\/zip/.test(haystack)) return "HTTP_ZIP";
  if (urls.some((url) => /^https?:\/\//i.test(url))) return "HTTP_FILE";
  return "UNKNOWN";
}

/** Only an exact verified endpoint can make a discovered distribution supported now. */
export function supportForDistribution(
  distribution: Pick<DataportalDistribution, "protocol" | "urls">,
  registry: VerifiedSourceRegistry,
): DiscoverySupport {
  if (distribution.protocol === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (distribution.urls.length === 0 || distribution.protocol === "UNKNOWN") return "INVALID";
  const matching = registry.sources.filter((source) =>
    source.endpointUrl !== undefined && distribution.urls.includes(source.endpointUrl),
  );
  if (matching.length > 1) return "AMBIGUOUS";
  return matching.length === 1 ? "SUPPORTED_NOW" : "UNSUPPORTED_ADAPTER";
}

/**
 * Parses exactly the RDF/JSON shape returned by the documented EntryScape search endpoint.
 * It fails closed for a child without one dataset subject; callers cannot accidentally treat a
 * publisher or distribution resource as a dataset.
 */
export function parseDataportalSearchResponse(
  response: unknown,
  retrievedAt: string,
  registry: VerifiedSourceRegistry,
): readonly DataportalDiscoveryRecord[] {
  const root = response as { resource?: { children?: readonly DataportalSearchChild[] } };
  const children = root?.resource?.children;
  if (!Array.isArray(children)) throw new Error("DATAPORTAL_INVALID_RESPONSE: resource.children must be an array.");

  return children.flatMap((child) => {
    const metadata = child.metadata;
    if (!metadata || typeof metadata !== "object") return [];
    const datasets = (Object.entries(metadata) as [string, RdfSubject][]).filter(([, subject]) => hasType(subject));
    if (datasets.length !== 1) return [];
    const [datasetUri, dataset] = datasets[0]!;
    const distributionIds = values(dataset, DCAT_DISTRIBUTION);
    const distributions = distributionIds.map((distributionId) => {
      const distribution = metadata[distributionId];
      const urls = [...new Set([...values(distribution, DCAT_DOWNLOAD_URL), ...values(distribution, DCAT_ACCESS_URL)])];
      const serviceUrls = values(distribution, DCAT_ACCESS_SERVICE).flatMap((serviceId) => values(metadata[serviceId], DCAT_ENDPOINT_URL));
      const allUrls = [...new Set([...urls, ...serviceUrls])];
      const mediaTypes = values(distribution, DCAT_MEDIA_TYPE);
      const protocol = classifyDataportalDistribution(allUrls, mediaTypes);
      return {
        distribution_id: distributionId,
        urls: allUrls,
        media_types: mediaTypes,
        protocol,
        support: supportForDistribution({ protocol, urls: allUrls }, registry),
      };
    });
    const publisherIdentifier = first(dataset, DCT_PUBLISHER);
    const publisherSubject = publisherIdentifier ? metadata[publisherIdentifier] : undefined;
    const recordId = child.contextId !== undefined && child.entryId !== undefined
      ? `${child.contextId}/${child.entryId}`
      : datasetUri;
    const serviceUrls = [...new Set(distributionIds.flatMap((distributionId) =>
      values(metadata[distributionId], DCAT_ACCESS_SERVICE)
        .flatMap((serviceId) => values(metadata[serviceId], DCAT_ENDPOINT_URL)),
    ))];
    return [{
      discovery_provider: DATAPORTAL_DISCOVERY_PROVIDER,
      discovery_record_id: recordId,
      dataset_identifier: first(dataset, DCT_IDENTIFIER) ?? datasetUri,
      title: first(dataset, DCT_TITLE),
      description: first(dataset, DCT_DESCRIPTION),
      publisher: publisherSubject ? first(publisherSubject, "http://xmlns.com/foaf/0.1/name") ?? first(publisherSubject, DCT_TITLE) : undefined,
      publisher_identifier: publisherIdentifier,
      themes: values(dataset, DCAT_THEME),
      spatial_coverage: first(dataset, DCT_SPATIAL),
      temporal_coverage: first(dataset, DCT_TEMPORAL),
      modified: first(dataset, DCT_MODIFIED),
      license: first(dataset, DCT_LICENSE),
      landing_page: first(dataset, DCAT_LANDING_PAGE),
      distributions,
      service_urls: serviceUrls,
      retrieved_at: retrievedAt,
      metadata_content_hash: sha256(metadata),
    }];
  });
}

/** Exact endpoint matching only: discovery metadata can never manufacture source authority. */
export function matchDataportalRecordToRegistry(
  record: DataportalDiscoveryRecord,
  registry: VerifiedSourceRegistry,
): RegistryMatch {
  const matches = record.distributions.flatMap((distribution) => registry.sources
    .filter((source) => source.endpointUrl !== undefined && distribution.urls.includes(source.endpointUrl))
    .map((source) => ({ source, distribution })));
  const sourceIds = [...new Set(matches.map(({ source }) => source.sourceId))];
  if (sourceIds.length === 1) {
    const match = matches[0]!;
    return { kind: "EXACT_EXISTING_SOURCE", source: match.source, distribution: match.distribution };
  }
  if (sourceIds.length > 1) return { kind: "AMBIGUOUS_SOURCE", source_ids: sourceIds };
  if (record.distributions.length === 0) return { kind: "REJECT", reason: "NO_DISTRIBUTION" };
  return {
    kind: "CANDIDATE_NEW_SOURCE",
    candidate: {
      kind: "CANDIDATE_NEW_SOURCE",
      discovery: record,
      suggested_mimer_domain: "environmental-data",
      suggested_relevance: "Discovery-only candidate; requires governed source approval.",
      authority_status: "UNAPPROVED",
    },
  };
}
