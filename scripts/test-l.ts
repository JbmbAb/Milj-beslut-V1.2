import fetch from 'node-fetch';
import * as fs from 'fs';

const key = "1KgesXeEzu8PsVzJSfs1dzciWVka";
const secret = "e5kqNfJ1N2Sj4FTpW7FRIMD_ansa";
const b64 = Buffer.from(key + ":" + secret).toString("base64");

const tokenEndpoints = [
    "https://apimanager.lantmateriet.se/oauth2/token",
    "https://apimanager-sandbox.lantmateriet.se/oauth2/token",
    "https://sandbox-apimanager.lantmateriet.se/oauth2/token",
];

async function tryEndpoint(url: string) {
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": "Basic " + b64,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "grant_type=client_credentials"
        });
        const text = await res.text();
        return `${url}\n  → HTTP ${res.status}: ${text.substring(0, 200)}\n\n`;
    } catch (e: any) {
        return `${url}\n  → ERROR: ${e.message}\n\n`;
    }
}

async function run() {
    let out = "=== TOKEN ENDPOINT TEST ===\n";
    out += `Key: ${key}\nSecret: ${secret}\n\n`;

    for (const url of tokenEndpoints) {
        out += await tryEndpoint(url);
    }

    fs.writeFileSync("token-test-results.txt", out, "utf8");
    process.stdout.write(out);
}

run().catch(console.error);
