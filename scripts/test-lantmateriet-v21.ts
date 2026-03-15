import dotenv from 'dotenv';
dotenv.config();

const consumerKey = process.env.LANTMATERIET_CONSUMER_KEY;
const consumerSecret = process.env.LANTMATERIET_CONSUMER_SECRET;
const tokenUrl = 'https://apimanager.lantmateriet.se/oauth2/token';

async function testV21Endpoint() {
    console.log('Testing V2.1 Fastighet Endpoint (REST)...');
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
            console.log('Token OK.');
            // Test multiple base URLs for Fastighet v1/v2
            const urls = [
                'https://api.lantmateriet.se/distribution/produkter/fastighet/v2.1/fastighet?beteckning=ORSA%20STACKMORA%201:1',
                'https://api.lantmateriet.se/fastighetsomrade/v1/fastighetsomrade?beteckning=ORSA%20STACKMORA%201:1'
            ];

            for (const url of urls) {
                console.log(`\nTesting URL: ${url}`);
                const apiRes = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${data.access_token}`,
                        'Accept': 'application/json'
                    }
                });
                console.log('Status:', apiRes.status);
                const text = await apiRes.text();
                console.log('Response Snippet:', text.slice(0, 300));
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

testV21Endpoint();
