/** Read-only census of every collection on Lantmäteriet's official public STAC catalog roots. */
import {
  LANTMATERIET_STAC_SURFACES,
  parseLantmaterietStacCollections,
  summarizeLantmaterietCatalog,
} from "../src/LantmaterietCatalogCensus";

async function main(): Promise<void> {
  const retrievedAt = new Date().toISOString();
  const groups = await Promise.all(Object.entries(LANTMATERIET_STAC_SURFACES).map(async ([family, serviceUrl]) => {
    const response = await fetch(`${serviceUrl}/collections`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`LM_CATALOG_HTTP_STATUS: ${response.status} for ${family}`);
    return parseLantmaterietStacCollections(family as keyof typeof LANTMATERIET_STAC_SURFACES, await response.json(), retrievedAt);
  }));
  const products = groups.flat();
  console.log(JSON.stringify({
    discovery_provider: "LANTMATERIET_STAC",
    retrieved_at: retrievedAt,
    total_products: products.length,
    total_distributions: products.length,
    by_family: summarizeLantmaterietCatalog(products),
    products,
  }, null, 2));
}

void main();
