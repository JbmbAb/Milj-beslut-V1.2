import {
  GovernedDownloadError,
  type DownloadTargetResolver,
  type DownloadTransport,
  type ResolvedDownloadPlan,
} from "./GovernedDownloadContracts";
import type { VerifiedSourceDefinition, VerifiedSourceRegistry } from "./SourceRegistry";

/**
 * P2 — adapter-keyed target resolution.
 *
 * Deciding WHAT to fetch is source-shaped: a WFS endpoint advertises its feature types, while a
 * plain API endpoint is a single object. Deciding HOW to fetch it under policy is not. Keeping
 * them apart stops adapter quirks from leaking into the governed download path.
 *
 * The `adapter` string on the registry entry selects the resolver. The registry therefore
 * decides which adapter a source uses, exactly as it decides approval and scope — no adapter
 * inference from URLs or channel guessing, which would put source semantics back in code.
 */

export interface SourceAwareTargetResolver {
  resolve(source: VerifiedSourceDefinition, execution_id: string): Promise<ResolvedDownloadPlan>;
}

/**
 * Fail-closed adapter lookup.
 *
 * An unknown adapter stops the run rather than falling back to "just fetch the endpoint".
 * A silent fallback would mean a source could be harvested by a different adapter than the one
 * it was approved with, and the manifest would not show it.
 */
export class DownloadTargetResolverRegistry implements DownloadTargetResolver {
  constructor(
    private readonly registry: VerifiedSourceRegistry,
    private readonly resolvers: Readonly<Record<string, SourceAwareTargetResolver>>,
  ) {}

  async resolve(input: {
    readonly source_id: string;
    readonly execution_id: string;
  }): Promise<ResolvedDownloadPlan> {
    const source = this.registry.getSource(input.source_id);
    if (!source) {
      throw new GovernedDownloadError(
        `REJECT_SOURCE: '${input.source_id}' is not an approved source in the verified registry.`,
        "REJECT_SOURCE",
      );
    }

    const resolver = this.resolvers[source.adapter];
    if (!resolver) {
      throw new GovernedDownloadError(
        `REJECT_ADAPTER: source '${source.sourceId}' is approved for adapter '${source.adapter}', ` +
          `for which no resolver is registered (have: ${Object.keys(this.resolvers).join(", ") || "none"}).`,
        "REJECT_ADAPTER",
      );
    }

    return resolver.resolve(source, input.execution_id);
  }
}

/** Shared guard — a source with no endpoint cannot be fetched under any adapter. */
function requireEndpoint(source: VerifiedSourceDefinition): string {
  if (!source.endpointUrl) {
    throw new GovernedDownloadError(
      `REJECT_SOURCE_ENDPOINT: source '${source.sourceId}' has no endpoint_url.`,
      "REJECT_SOURCE_ENDPOINT",
    );
  }
  return source.endpointUrl;
}

/**
 * One source, one object — the registry's endpoint IS the target.
 *
 * Correct for API, WEBSITE and single-file dataset endpoints. Deliberately does not attempt
 * pagination or crawling: both need per-source knowledge that only the registry can legitimately
 * carry, and inventing it here would be adapter behaviour nobody approved.
 */
export class SingleEndpointTargetResolver implements SourceAwareTargetResolver {
  async resolve(source: VerifiedSourceDefinition): Promise<ResolvedDownloadPlan> {
    const url = requireEndpoint(source);
    // Never NO_CHANGES: a single fixed endpoint either exists or the source is misconfigured.
    // There is no listing to observe, so there is nothing that could legitimately be empty.
    return { kind: "TARGETS", targets: [{ url, file_name: fileNameFor(url, source.sourceId) }] };
  }
}

/**
 * WFS — read the capabilities document, emit one GetFeature target per advertised feature type.
 *
 * The type names come from the service itself rather than from a hand-maintained list, so the
 * harvest follows what the authority actually publishes. It uses the governed transport, so the
 * capabilities request is subject to the same scope, size and timeout policy as the data.
 */
export class WfsCapabilitiesTargetResolver implements SourceAwareTargetResolver {
  constructor(
    private readonly transport: DownloadTransport,
    private readonly outputFormat = "application/gml+xml; version=3.2",
  ) {}

  async resolve(source: VerifiedSourceDefinition): Promise<ResolvedDownloadPlan> {
    const endpoint = requireEndpoint(source);
    const capabilitiesUrl = withParams(endpoint, {
      service: "WFS",
      request: "GetCapabilities",
    });

    const response = await this.transport.get(capabilitiesUrl, {
      timeout_ms: 30_000,
      max_bytes: source.policy.max_object_size_bytes,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new GovernedDownloadError(
        `REJECT_CAPABILITIES: ${response.status} from '${capabilitiesUrl}'.`,
        "REJECT_HTTP_STATUS",
      );
    }

    const typeNames = parseWfsTypeNames(new TextDecoder().decode(response.bytes));

    if (typeNames.length === 0) {
      throw new GovernedDownloadError(
        `REJECT_CAPABILITIES: '${capabilitiesUrl}' advertised no feature types. Emitting zero ` +
          "targets would be indistinguishable from a source that is simply empty.",
        "REJECT_CAPABILITIES",
      );
    }

    const version = parseWfsVersion(new TextDecoder().decode(response.bytes));

    // Still never NO_CHANGES. A capabilities document advertising nothing is a broken service,
    // not a quiet day — the REJECT_CAPABILITIES above already fails that case closed.
    const targets = typeNames.map((typeName) => ({
      url: withParams(endpoint, {
        service: "WFS",
        version,
        request: "GetFeature",
        // WFS 2.0 renamed the parameter; using the wrong one silently returns an exception
        // document with HTTP 200, which would be quarantined as if it were data.
        ...(version.startsWith("2.") ? { typeNames: typeName } : { typeName }),
        outputFormat: this.outputFormat,
      }),
      file_name: `${sanitize(typeName)}.gml`,
    }));

    return { kind: "TARGETS", targets };
  }
}

/** Minimal, namespace-agnostic extraction of `<FeatureType><Name>` values. */
export function parseWfsTypeNames(xml: string): readonly string[] {
  const names: string[] = [];
  const featureTypeBlocks = xml.match(/<(?:\w+:)?FeatureType\b[\s\S]*?<\/(?:\w+:)?FeatureType>/g) ?? [];
  for (const block of featureTypeBlocks) {
    const match = block.match(/<(?:\w+:)?Name\b[^>]*>([^<]+)<\/(?:\w+:)?Name>/);
    if (match?.[1]) names.push(match[1].trim());
  }
  return [...new Set(names)];
}

/**
 * Reads the version from the capabilities ROOT ELEMENT.
 *
 * A bare `version="..."` search matches `<?xml version="1.0"?>` first, which every capabilities
 * document starts with. That produced "1.0" for a WFS 2.0 service and therefore the wrong
 * parameter name — a silent failure, because the server answers a malformed GetFeature with an
 * exception document under HTTP 200.
 */
export function parseWfsVersion(xml: string): string {
  return (
    xml.match(/<(?:\w+:)?WFS_Capabilities\b[^>]*?\sversion\s*=\s*["']([\d.]+)["']/)?.[1] ?? "2.0.0"
  );
}

function withParams(endpoint: string, params: Record<string, string>): string {
  const url = new URL(endpoint);
  // Case-insensitively replaced: OGC parameter names are case-insensitive, and leaving a
  // stale `REQUEST=GetCapabilities` from the registry URL would silently win.
  for (const key of Object.keys(params)) {
    for (const existing of [...url.searchParams.keys()]) {
      if (existing.toLowerCase() === key.toLowerCase()) url.searchParams.delete(existing);
    }
  }
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function fileNameFor(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? sanitize(last) : `${sanitize(fallback)}.bin`;
  } catch {
    return `${sanitize(fallback)}.bin`;
  }
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "object";
}
