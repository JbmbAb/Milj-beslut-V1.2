import { loadEnvFile } from '../server/loadEnv';

// Force clear before loading to ensure we get what's in the files
delete process.env.LANTMATERIET_BASE_URL;
delete process.env.LANTMATERIET_CONSUMER_KEY;
delete process.env.LANTMATERIET_CONSUMER_SECRET;

loadEnvFile('.env');
loadEnvFile('.env.local');

import { testLantmaterietConnection } from '../server/services/lantmaterietService';

async function main() {
  console.log('LANTMATERIET_CONSUMER_KEY:', process.env.LANTMATERIET_CONSUMER_KEY);
  console.log('LANTMATERIET_BASE_URL:', process.env.LANTMATERIET_BASE_URL);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('Testar Lantmäteriet-anslutning...');
  try {
    const result = await testLantmaterietConnection();
    console.log(JSON.stringify(result, null, 2));
    if (result.ok) {
      console.log('✅ Lantmäteriet fungerar!');
    } else {
      console.log('❌ Lantmäteriet fungerar INTE.');
      console.log('Fel:', result.error);
    }
  } catch (err) {
    console.error('Ett oväntat fel uppstod:', err);
  }
}

main();
