import fetch from 'node-fetch';

const key = "1KgesXeEzu8PsVzJSfs1dzciWVka";
const secret = "e5kqNfJ1N2Sj4FTpW7FRIMD_ansa";

async function run() {
    // Steg 1: Hämta access token
    const b64 = Buffer.from(key + ":" + secret).toString("base64");
    console.log("Hämtar token från https://apimanager.lantmateriet.se/oauth2/token ...");

    const tokenRes = await fetch("https://apimanager.lantmateriet.se/oauth2/token", {
        method: "POST",
        headers: {
            "Authorization": "Basic " + b64,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    const tokenData = await tokenRes.json() as any;
    console.log("Token response status:", tokenRes.status);
    console.log("Token response:", JSON.stringify(tokenData));

    if (!tokenData.access_token) {
        console.error("Fick ingen access_token. Avbryter.");
        return;
    }

    const token = tokenData.access_token;
    console.log("Fick access token!");

    // Steg 2: Hämta kommunpolygoner
    const url = "https://api-ver.lantmateriet.se/ogc-features/v1/administrativ-indelning/collections/kommuner/items?limit=2";
    console.log("Hämtar GIS-data:", url);

    const res = await fetch(url, {
        headers: {
            "Authorization": "Bearer " + token,
            "Accept": "application/geo+json"
        }
    });

    console.log("GIS HTTP Status:", res.status);
    const data = await res.json() as any;

    if (data.features?.length) {
        console.log("Antal features:", data.features.length);
        console.log("Properties:", JSON.stringify(data.features[0].properties, null, 2));
        console.log("geometry.type:", data.features[0].geometry?.type);
        console.log("geometry.coordinates (utdrag):", JSON.stringify(data.features[0].geometry?.coordinates, null, 2).substring(0, 500) + "...");
    } else {
        console.log("Inga features. Svar:", JSON.stringify(data));
    }
}

run().catch(console.error);
