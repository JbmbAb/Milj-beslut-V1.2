import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

async function run() {
    const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
    const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
    const tokenUrl = process.env.LANTMATERIET_TOKEN_URL;
    const baseUrl = process.env.LANTMATERIET_BASE_URL;

    console.log("Fetching token...");
    const creds = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
    const tokenRes = await fetch(tokenUrl!, {
        method: "POST",
        headers: {
            Authorization: `Basic ${creds}`,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
    });

    if (!tokenRes.ok) {
        console.error("Failed token:", await tokenRes.text());
        return;
    }
    const tokenData = await tokenRes.json() as { access_token: string };
    const token = tokenData.access_token;
    console.log("Token received.");

    console.log("Fetching collections...");
    const url = `${baseUrl}/collections?f=json`;
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`
        }
    });

    if (!res.ok) {
        console.error("Collections failed:", await res.text());
        return;
    }
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}

run();
