import { describe, expect, it } from "vitest";

import {
  classifyLantmaterietAccess,
  parseLantmaterietStacCollections,
  summarizeLantmaterietCatalog,
} from "../src/LantmaterietCatalogCensus";

const response = { collections: [{
  id: "fastighetsindelning",
  title: "Fastighetsindelning",
  description: "Kommunindelad GeoPackage.",
  links: [{ rel: "self", href: "https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning" }],
}] };

describe("Lantmäteriet full catalog census", () => {
  it("keeps product, distribution, and content identities distinct", () => {
    const [product] = parseLantmaterietStacCollections("VECTOR", response, "2026-10-09T00:00:00.000Z");
    expect(product).toMatchObject({
      product_id: "VECTOR:fastighetsindelning",
      distribution_id: "VECTOR:fastighetsindelning:items",
      distribution_url: "https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning/items",
      protocol: "STAC",
      access_class: "ACCESS_PENDING",
    });
    expect(product?.metadata_content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires an authenticated entitlement proof before classifying a distribution as ready", () => {
    expect(classifyLantmaterietAccess({ catalog_visible: true, authenticated_probe: "NOT_PROBED" })).toBe("ACCESS_PENDING");
    expect(classifyLantmaterietAccess({ catalog_visible: true, authenticated_probe: "DENIED" })).toBe("RESTRICTED");
    expect(classifyLantmaterietAccess({ catalog_visible: true, authenticated_probe: "AUTHORIZED" })).toBe("ACCESS_READY");
  });

  it("is deterministic across an unchanged catalog replay", () => {
    const first = parseLantmaterietStacCollections("VECTOR", response, "2026-10-09T00:00:00.000Z");
    const replay = parseLantmaterietStacCollections("VECTOR", response, "2026-10-09T00:00:00.000Z");
    expect(replay).toEqual(first);
    expect(summarizeLantmaterietCatalog(first)).toMatchObject({ VECTOR: 1, HEIGHT: 0, MAP: 0, IMAGE: 0 });
  });

  it("rejects a malformed collection rather than inventing an identity", () => {
    expect(() => parseLantmaterietStacCollections("VECTOR", { collections: [{ title: "missing id" }] }, "2026-10-09T00:00:00.000Z")).toThrow("collection.id");
  });
});
