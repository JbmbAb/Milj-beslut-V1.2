import { createHash } from "node:crypto";

/** Official public STAC catalog surfaces exposed by Lantmäteriet at the time of census. */
export const LANTMATERIET_STAC_SURFACES = Object.freeze({
  VECTOR: "https://api.lantmateriet.se/stac-vektor/v1",
  HEIGHT: "https://api.lantmateriet.se/stac-hojd/v1",
  MAP: "https://api.lantmateriet.se/stac-karta/v1",
  IMAGE: "https://api.lantmateriet.se/stac-bild/v1",
} as const);

export type LantmaterietStacFamily = keyof typeof LANTMATERIET_STAC_SURFACES;
export type LantmaterietAccessClass =
  | "OPEN_NO_AUTH"
  | "ACCESS_READY"
  | "ACCESS_PENDING"
  | "PURPOSE_REVIEW_REQUIRED"
  | "RESTRICTED"
  | "VIEW_ONLY"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface LantmaterietCatalogProduct {
  readonly discovery_provider: "LANTMATERIET_STAC";
  readonly publisher: "Lantmäteriet";
  readonly publisher_identifier: "SE2021004888";
  /** Surface + collection ID is a catalog identity, never a content hash. */
  readonly product_id: string;
  readonly dataset_identifier: string;
  readonly title: string;
  readonly description?: string;
  readonly product_family: LantmaterietStacFamily;
  readonly official_landing_page: string;
  /** A collection is the canonical discoverable distribution boundary. */
  readonly distribution_id: string;
  readonly distribution_url: string;
  readonly service_url: string;
  readonly protocol: "STAC";
  readonly media_type: "application/json";
  readonly access_class: LantmaterietAccessClass;
  readonly retrieved_at: string;
  readonly metadata_content_hash: string;
}

interface StacCollection {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly links?: readonly { readonly rel?: unknown; readonly href?: unknown }[];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`LM_CATALOG_INVALID: ${field} must be a non-empty string.`);
  return value;
}

/**
 * Catalog listing visibility is deliberately not an entitlement claim.  `ACCESS_READY` is only
 * possible after an authenticated distribution probe has succeeded for that product.
 */
export function classifyLantmaterietAccess(input: {
  readonly catalog_visible: boolean;
  readonly authenticated_probe: "AUTHORIZED" | "DENIED" | "NOT_PROBED";
  readonly purpose_review_required?: boolean;
  readonly view_only?: boolean;
  readonly known_access_pending?: boolean;
}): LantmaterietAccessClass {
  if (!input.catalog_visible) return "UNAVAILABLE";
  if (input.known_access_pending) return "ACCESS_PENDING";
  if (input.view_only) return "VIEW_ONLY";
  if (input.purpose_review_required) return "PURPOSE_REVIEW_REQUIRED";
  if (input.authenticated_probe === "AUTHORIZED") return "ACCESS_READY";
  if (input.authenticated_probe === "DENIED") return "RESTRICTED";
  return "ACCESS_PENDING";
}

/** Parses the official STAC `collections` response; unknown fields are retained only in its hash. */
export function parseLantmaterietStacCollections(
  surface: LantmaterietStacFamily,
  response: unknown,
  retrievedAt: string,
  options: { readonly authenticatedProbe?: "AUTHORIZED" | "DENIED" | "NOT_PROBED" } = {},
): readonly LantmaterietCatalogProduct[] {
  const collections = (response as { readonly collections?: unknown }).collections;
  if (!Array.isArray(collections)) throw new Error("LM_CATALOG_INVALID: collections must be an array.");
  const serviceUrl = LANTMATERIET_STAC_SURFACES[surface];
  return collections.map((raw) => {
    const collection = raw as StacCollection;
    const id = string(collection.id, "collection.id");
    const title = string(collection.title, "collection.title");
    const self = collection.links?.find((link) => link.rel === "self" && typeof link.href === "string")?.href;
    const collectionUrl = typeof self === "string" ? self : `${serviceUrl}/collections/${encodeURIComponent(id)}`;
    const itemsUrl = `${collectionUrl.replace(/\/$/, "")}/items`;
    return {
      discovery_provider: "LANTMATERIET_STAC",
      publisher: "Lantmäteriet",
      publisher_identifier: "SE2021004888",
      product_id: `${surface}:${id}`,
      dataset_identifier: id,
      title,
      ...(typeof collection.description === "string" && collection.description ? { description: collection.description } : {}),
      product_family: surface,
      official_landing_page: collectionUrl,
      distribution_id: `${surface}:${id}:items`,
      distribution_url: itemsUrl,
      service_url: serviceUrl,
      protocol: "STAC",
      media_type: "application/json",
      access_class: classifyLantmaterietAccess({
        catalog_visible: true,
        authenticated_probe: options.authenticatedProbe ?? "NOT_PROBED",
      }),
      retrieved_at: retrievedAt,
      metadata_content_hash: hash(raw),
    };
  });
}

export function summarizeLantmaterietCatalog(products: readonly LantmaterietCatalogProduct[]): Readonly<Record<LantmaterietStacFamily, number>> {
  return Object.freeze(Object.fromEntries(
    (Object.keys(LANTMATERIET_STAC_SURFACES) as LantmaterietStacFamily[])
      .map((family) => [family, products.filter((product) => product.product_family === family).length]),
  ) as Record<LantmaterietStacFamily, number>);
}
