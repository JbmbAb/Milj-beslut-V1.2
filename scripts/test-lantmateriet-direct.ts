import dotenv from "dotenv";

dotenv.config();

const designation = process.argv[2] || "ORSA STACKMORA 3:12";
const baseUrl = (process.env.LANTMATERIET_BASE_URL || "https://api.lantmateriet.se/ogc-features/v1").replace(/\/+$/, "");
const collection = process.env.LANTMATERIET_OGC_COLLECTION || "registerenhetsomradesytor";
const tokenUrl = process.env.LANTMATERIET_TOKEN_URL || "https://apimanager.lantmateriet.se/oauth2/token";

async function getAccessToken(): Promise<string> {
  const directToken = process.env.LANTMATERIET_ACCESS_TOKEN?.trim();
  if (directToken) {
    return directToken;
  }

  const clientId = process.env.LANTMATERIET_CONSUMER_KEY?.trim();
  const clientSecret = process.env.LANTMATERIET_CONSUMER_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing LANTMATERIET_ACCESS_TOKEN or consumer key/secret.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token fetch failed (${resp.status}): ${err}`);
  }

  const json = (await resp.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new Error("Token fetch succeeded but no access_token was returned.");
  }

  return json.access_token;
}

async function main(): Promise<void> {
  const token = await getAccessToken();
  const safeDesignation = designation.replace(/'/g, "''");
  const filter = `etikett = '${safeDesignation}'`;
  const url = `${baseUrl}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?filter=${encodeURIComponent(filter)}&filter-lang=cql2-text&limit=1`;

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/geo+json, application/json",
    },
  });

  const body = await resp.text();
  console.log(`HTTP ${resp.status}`);

  if (!resp.ok) {
    if (resp.status === 403 && /scope|900910|not authorized/i.test(body)) {
      console.log("Token saknar scope for OGC fastighetsindelning.");
      console.log("Begarscope: ogc-features:fastighetsindelning.read");
    }
    console.log(body.slice(0, 600));
    process.exitCode = 1;
    return;
  }

  const parsed = JSON.parse(body) as { features?: Array<{ properties?: Record<string, unknown> }> };
  const first = parsed.features?.[0];
  if (!first) {
    console.log("Ingen fastighet hittades med den beteckningen.");
    return;
  }

  console.log("OK: fastighet hittad");
  console.log(`etikett: ${String(first.properties?.etikett ?? designation)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

