import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

type TokenResponse = {
    access_token: string;
};

type ItemsResponse = {
    features: Array<{ assets: unknown }>;
};

async function main() {
    const CONSUMER_KEY = process.env.LANTMATERIET_CONSUMER_KEY;
    const CONSUMER_SECRET = process.env.LANTMATERIET_CONSUMER_SECRET;
    const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api.lantmateriet.se/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
    });
    const tokenData = await tokenRes.json() as TokenResponse;
    const token = tokenData.access_token;

    const res = await fetch('https://api.lantmateriet.se/stac-vektor/v1/collections/fastighetsindelning/items?limit=1', {
        headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json() as ItemsResponse;
    console.log(JSON.stringify(data.features[0].assets, null, 2));
}
main();
