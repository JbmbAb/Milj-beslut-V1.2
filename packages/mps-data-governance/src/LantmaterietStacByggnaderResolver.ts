import {
  GovernedDownloadError,
  type DownloadTarget,
  type DownloadTransport,
  type ResolvedDownloadPlan,
} from "./GovernedDownloadContracts";
import { assertByggnaderAssetUrl } from "./LantmaterietStacByggnaderAssetTransport";
import type { SourceAwareTargetResolver } from "./DownloadTargetResolvers";
import type { VerifiedSourceDefinition } from "./SourceRegistry";

export const LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL =
  "https://api.lantmateriet.se/stac-vektor/v1/collections/byggnader/items";
export const LANTMATERIET_STAC_BYGGNADER_PAGE_SIZE = 100;
export const LANTMATERIET_STAC_BYGGNADER_MAX_PAGES = 10;

interface StacLink {
  readonly rel?: unknown;
  readonly href?: unknown;
}

interface StacAsset {
  readonly href?: unknown;
  readonly type?: unknown;
}

interface StacItem {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly collection?: unknown;
  readonly properties?: { readonly updated?: unknown };
  readonly assets?: Readonly<Record<string, StacAsset>>;
}

interface StacFeatureCollection {
  readonly type?: unknown;
  readonly features?: unknown;
  readonly links?: unknown;
}

/**
 * Enumerates the exact public STAC `byggnader` collection. It performs discovery only;
 * ZIP bytes still flow through the executor and its separately supplied asset transport.
 */
export class LantmaterietStacByggnaderTargetResolver implements SourceAwareTargetResolver {
  constructor(
    private readonly listingTransport: DownloadTransport,
    private readonly pageSize: number = LANTMATERIET_STAC_BYGGNADER_PAGE_SIZE,
    private readonly maxPages: number = LANTMATERIET_STAC_BYGGNADER_MAX_PAGES,
  ) {}

  async resolve(source: VerifiedSourceDefinition): Promise<ResolvedDownloadPlan> {
    const initialUrl = source.endpointUrl;
    assertByggnaderCollectionUrl(initialUrl);

    const targets: DownloadTarget[] = [];
    const seenPages = new Set<string>();
    const seenItems = new Map<string, string>();
    let currentUrl = withPageSize(initialUrl, this.pageSize);

    for (let page = 0; page < this.maxPages; page++) {
      assertByggnaderCollectionUrl(currentUrl);
      if (seenPages.has(currentUrl)) {
        throw new GovernedDownloadError(
          "REJECT_STAC_PAGE_LOOP: the collection repeated a previously examined page.",
          "REJECT_STAC_PAGE_LOOP",
        );
      }
      seenPages.add(currentUrl);

      const response = await this.listingTransport.get(currentUrl, {
        timeout_ms: 30_000,
        max_bytes: source.policy.max_object_size_bytes,
      });
      if (response.status < 200 || response.status >= 300) {
        throw new GovernedDownloadError(
          `REJECT_STAC_LISTING_STATUS: ${response.status} from '${currentUrl}'.`,
          "REJECT_HTTP_STATUS",
        );
      }

      const listing = parseStacFeatureCollection(new TextDecoder().decode(response.bytes), currentUrl);
      const items = listing.features as readonly StacItem[];
      if (items.length === 0) {
        throw new GovernedDownloadError(
          "REJECT_STAC_EMPTY_PAGE: an authoritative building collection page contained no items.",
          "REJECT_STAC_EMPTY_PAGE",
        );
      }

      for (const item of items) {
        const target = targetForItem(item);
        const fingerprint = [
          target.source_metadata?.lm_stac_item_updated,
          target.source_metadata?.lm_stac_asset_href,
          target.source_metadata?.lm_stac_asset_media_type,
        ].join("\n");
        const itemId = target.source_metadata?.lm_stac_item_id!;
        const prior = seenItems.get(itemId);
        if (prior !== undefined) {
          throw new GovernedDownloadError(
            prior === fingerprint
              ? `REJECT_STAC_DUPLICATE_ITEM: item '${itemId}' appeared more than once.`
              : `REJECT_STAC_CONFLICTING_ITEM: item '${itemId}' changed during enumeration.`,
            prior === fingerprint ? "REJECT_STAC_DUPLICATE_ITEM" : "REJECT_STAC_CONFLICTING_ITEM",
          );
        }
        seenItems.set(itemId, fingerprint);
        targets.push(target);
      }

      const next = nextPageUrl(listing.links, currentUrl);
      if (!next) return { kind: "TARGETS", targets };
      currentUrl = withPageSize(next, this.pageSize);
    }

    throw new GovernedDownloadError(
      `REJECT_STAC_PAGE_LIMIT: building collection exceeded ${this.maxPages} pages.`,
      "REJECT_STAC_PAGE_LIMIT",
    );
  }
}

export function assertByggnaderCollectionUrl(url: string | undefined): asserts url is string {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new GovernedDownloadError(
      "REJECT_STAC_COLLECTION_SCOPE: building collection URL is invalid.",
      "REJECT_STAC_COLLECTION_SCOPE",
    );
  }

  const expected = new URL(LANTMATERIET_STAC_BYGGNADER_COLLECTION_URL);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== expected.hostname ||
    parsed.pathname !== expected.pathname ||
    parsed.username ||
    parsed.password ||
    [...parsed.searchParams.keys()].some((key) => key !== "limit" && key !== "token")
  ) {
    throw new GovernedDownloadError(
      "REJECT_STAC_COLLECTION_SCOPE: URL is outside the Lantmäteriet byggnader collection scope.",
      "REJECT_STAC_COLLECTION_SCOPE",
    );
  }
}

export function parseStacFeatureCollection(body: string, sourceUrl: string): StacFeatureCollection & {
  readonly features: readonly StacItem[];
  readonly links: readonly StacLink[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new GovernedDownloadError(
      `REJECT_STAC_LISTING_SHAPE: '${sourceUrl}' did not return JSON.`,
      "REJECT_STAC_LISTING_SHAPE",
    );
  }

  const listing = parsed as StacFeatureCollection;
  if (
    !listing ||
    listing.type !== "FeatureCollection" ||
    !Array.isArray(listing.features) ||
    !Array.isArray(listing.links)
  ) {
    throw new GovernedDownloadError(
      `REJECT_STAC_LISTING_SHAPE: '${sourceUrl}' is not a STAC FeatureCollection.`,
      "REJECT_STAC_LISTING_SHAPE",
    );
  }
  return listing as StacFeatureCollection & { readonly features: readonly StacItem[]; readonly links: readonly StacLink[] };
}

function targetForItem(item: StacItem): DownloadTarget {
  if (item.type !== "Feature" || typeof item.id !== "string" || item.id.length === 0) {
    throw new GovernedDownloadError(
      "REJECT_STAC_ITEM_SHAPE: item lacks a stable STAC item identity.",
      "REJECT_STAC_ITEM_SHAPE",
    );
  }
  if (item.collection !== "byggnader") {
    throw new GovernedDownloadError(
      `REJECT_STAC_COLLECTION: item '${item.id}' is not in collection 'byggnader'.`,
      "REJECT_STAC_COLLECTION",
    );
  }
  const updated = item.properties?.updated;
  if (typeof updated !== "string" || updated.length === 0) {
    throw new GovernedDownloadError(
      `REJECT_STAC_ITEM_SHAPE: item '${item.id}' lacks observed updated metadata.`,
      "REJECT_STAC_ITEM_SHAPE",
    );
  }

  const assets = Object.entries(item.assets ?? {}).filter(([, asset]) => asset?.type === "application/zip");
  if (assets.length !== 1) {
    throw new GovernedDownloadError(
      `REJECT_STAC_ASSET: item '${item.id}' must expose exactly one ZIP asset.`,
      "REJECT_STAC_ASSET",
    );
  }
  const [assetKey, asset] = assets[0];
  if (assetKey !== "data" || typeof asset.href !== "string") {
    throw new GovernedDownloadError(
      `REJECT_STAC_ASSET: item '${item.id}' has no unambiguous data ZIP asset.`,
      "REJECT_STAC_ASSET",
    );
  }
  assertByggnaderAssetUrl(asset.href);

  return {
    url: asset.href,
    file_name: `byggnad_kn${item.id}.zip`,
    source_metadata: {
      lm_stac_collection: "byggnader",
      lm_stac_item_id: item.id,
      lm_stac_item_updated: updated,
      lm_stac_asset_href: asset.href,
      lm_stac_asset_media_type: "application/zip",
    },
  };
}

function nextPageUrl(links: readonly StacLink[], currentUrl: string): string | null {
  const nextLinks = links.filter((link) => link.rel === "next");
  if (nextLinks.length === 0) return null;
  if (nextLinks.length !== 1 || typeof nextLinks[0].href !== "string") {
    throw new GovernedDownloadError(
      "REJECT_STAC_PAGINATION: collection returned ambiguous next-page links.",
      "REJECT_STAC_PAGINATION",
    );
  }
  const next = new URL(nextLinks[0].href, currentUrl).toString();
  assertByggnaderCollectionUrl(next);
  return next;
}

function withPageSize(url: string, pageSize: number): string {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 300) {
    throw new GovernedDownloadError(
      "REJECT_STAC_PAGE_SIZE: page size must be an integer between 1 and 300.",
      "REJECT_STAC_PAGE_SIZE",
    );
  }
  const parsed = new URL(url);
  parsed.searchParams.set("limit", String(pageSize));
  return parsed.toString();
}
