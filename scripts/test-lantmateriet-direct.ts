import { loadEnvFile } from '../server/loadEnv';
delete process.env.LANTMATERIET_BASE_URL;
delete process.env.LANTMATERIET_CONSUMER_KEY;
delete process.env.LANTMATERIET_CONSUMER_SECRET;
loadEnvFile('.env');
loadEnvFile('.env.local');

import { testLantmaterietConnection } from '../server/services/lantmaterietService';

async function main() {
  console.log('Testar Lantmäteriet med OGC...');
  const resultOgc = await testLantmaterietConnection();
  console.log('OGC Result:', resultOgc.ok ? 'OK' : 'FAIL', resultOgc.error);

  // Now try Direct API manually
  console.log('\nTestar Lantmäteriet med Direct API (Fastighet v2.1)...');
  try {
    const { getLantmaterietAccessToken } = await import('../server/services/lantmaterietService');
    const token = await getLantmaterietAccessToken();
    const directUrl = 'https://api.lantmateriet.se/distribution/produkter/fastighet/v2.1/fastighet?beteckning=NACKA%20BOO%201:1';
    
    const resp = await fetch(directUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });
    
    console.log('Direct API Status:', resp.status);
    const data = await resp.text();
    console.log('Direct API Svar:', data.slice(0, 500));
  } catch (err) {
    console.error('Direct API Error:', err);
  }
}

main();
