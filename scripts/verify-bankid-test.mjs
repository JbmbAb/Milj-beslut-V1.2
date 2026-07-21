import fs from 'node:fs';
import https from 'node:https';
import { config as loadEnv } from 'dotenv';

loadEnv();

const baseUrl = process.env.BANKID_BASE_URL;
const pfxPath = process.env.BANKID_PFX_PATH;
const passphrase = process.env.BANKID_PFX_PASSPHRASE;
const caPath = process.env.BANKID_CA_PATH;

if (!baseUrl || !pfxPath) {
  console.error('Missing BANKID_BASE_URL or BANKID_PFX_PATH in .env');
  process.exit(1);
}

const agent = new https.Agent({
  pfx: fs.readFileSync(pfxPath),
  passphrase,
  ca: caPath ? fs.readFileSync(caPath) : undefined,
  minVersion: 'TLSv1.2',
});

const url = new URL(baseUrl);
const body = JSON.stringify({ endUserIp: '127.0.0.1' });

const req = https.request(
  {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname.replace(/\/$/, '')}/auth`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    agent,
    timeout: 15000,
  },
  (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      console.log('HTTP', res.statusCode);
      console.log(text);
      process.exit(res.statusCode && res.statusCode < 400 ? 0 : 2);
    });
  },
);

req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', (error) => {
  console.error('Request failed:', error.message);
  process.exit(2);
});
req.write(body);
req.end();
