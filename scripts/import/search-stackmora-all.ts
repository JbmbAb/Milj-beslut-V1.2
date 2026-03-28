import "dotenv/config";
import fetch from "node-fetch";

async function main() {
  const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET?.trim();
  const scope = process.env.LANTMATERIET_SCOPE?.trim() || "ogc-features:fastighetsindelning.read";
  const baseUrl = "https://api.lantmateriet.se/ogc-features/v1";
  const tokenUrl = "https://api.lantmateriet.se/token";

  if (!consumerKey || !consumerSecret) {
    console.error("Missing credentials");
    process.exit(1);
  }

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });

  const { access_token } = (await tokenRes.json()) as any;
  
  const cql = "kommunnamn = 'ORSA' AND trakt = 'STACKMORA'";
  const url = `${baseUrl}/fastighetsindelning/collections/registerenhetsomradesytor/items?filter=${encodeURIComponent(cql)}&filter-lang=cql2-text&limit=1000`;
  
  console.log(`Fetching ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: "application/geo+json" }
  });

  const data = await res.json() as any;
  console.log(`Found ${data.features?.length} features.`);
  
  const hits = (data.features || []).filter((f: any) => f.properties.etikett === "3:12" || f.properties.etikett?.includes("3:12"));
  console.log(`Hits for 3:12: ${hits.length}`);
  hits.forEach((h: any) => console.log(JSON.stringify(h.properties, null, 2)));

  if (hits.length === 0) {
      console.log("Samples of etikett starting with 3:");
      const sampled = (data.features || []).filter((f: any) => f.properties.etikett?.startsWith("3:"));
      sampled.forEach((f: any) => console.log(f.properties.etikett));
  }
}

main();
