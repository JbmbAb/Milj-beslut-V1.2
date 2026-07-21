const consumerKey = 'sNRTGMemeL0ZOH0znI4E0vCnqd0a';
const consumerSecret = 'Ybnhw86PkD2kQetlqlQxwCqP2nUa';
const tokenUrl = 'https://api.lantmateriet.se/token';

const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

async function main() {
  console.log('Testar token-hämtning...');
  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=client_credentials`,
    });
    console.log('Status:', response.status);
    const text = await response.text();
    console.log('Svar:', text);
  } catch (err) {
    console.error('Fetch failed:', err);
  }
}

main();
