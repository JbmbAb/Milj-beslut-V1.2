import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
const tokenUrl = 'https://apimanager.lantmateriet.se/oauth2/token';

async function logResult(res: any) {
    fs.appendFileSync('lantmateriet-test.log', res + '\n');
}

async function testAllPossibleEndpoints() {
    fs.writeFileSync('lantmateriet-test.log', 'Start test\n');
    const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: 'grant_type=client_credentials'
        });
        const data = await response.json();
        if (response.status === 200) {
            logResult('Token OK');
            const token = data.access_token;

            // Try OGC without scope again just to be sure
            const ogcUrl = 'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning/collections/registerenhetsomradesytor/items?filter=etikett%20%3D%20%27ORSA%20STACKMORA%201%3A1%27&filter-lang=cql2-text&limit=1';
            const logEndpoint = async (url: string) => {
                const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } });
                const status = res.status;
                const text = await res.text();
                logResult(`URL: ${url}\nStatus: ${status}\nSnippet: ${text.slice(0, 100)}`);
            };

            await logEndpoint(ogcUrl);
            await logEndpoint('https://api.lantmateriet.se/fastighetsomrade/v1/fastighetsomrade?beteckning=ORSA%20STACKMORA%201%3A1');
            await logEndpoint('https://api.lantmateriet.se/distribution/produkter/fastighet/v2.1/fastighet?beteckning=ORSA%20STACKMORA%201%3A1');
        } else {
            logResult('Token Fail: ' + JSON.stringify(data));
        }
    } catch (e: any) {
        logResult('Global Error: ' + e.message);
    }
}

testAllPossibleEndpoints();
