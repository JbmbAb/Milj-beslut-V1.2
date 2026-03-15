import dotenv from 'dotenv';
dotenv.config();

const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
const tokenUrl = process.env.LANTMATERIET_TOKEN_URL || 'https://api.lantmateriet.se/token';

async function testSingleScope(scope: string) {
    console.log(`\n--- Testing Scope: ${scope} ---`);
    const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    try {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: `grant_type=client_credentials&scope=${scope}`
        });
        const status = response.status;
        const data = await response.json();
        console.log('Token Status:', status);
        if (status === 200) {
            console.log('Access Token Received.');
            const base = 'https://api.lantmateriet.se/ogc-features/v1';
            const collection = 'registerenhetsomradesytor';
            const filter = "etikett = 'ORSA STACKMORA 1:1'";
            const url = `${base}/fastighetsindelning/collections/${encodeURIComponent(collection)}/items?filter=${encodeURIComponent(filter)}&filter-lang=cql2-text&limit=1`;

            const ogcRes = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${data.access_token}`,
                    'Accept': 'application/json'
                }
            });
            console.log('OGC Status:', ogcRes.status);
            const ogcText = await ogcRes.text();
            console.log('OGC Response:', ogcText.slice(0, 300));
        } else {
            console.log('Token Error Data:', data);
        }
    } catch (e) {
        console.error('Test Error:', e);
    }
}

async function run() {
    await testSingleScope('ogc-features:fastighetsindelning.read');
    await testSingleScope('ogc-features:fastighetsindelning:read'); // Try with colon if dot fails
    await testSingleScope('ogc-features.fastighetsindelning.read');
}

run();
