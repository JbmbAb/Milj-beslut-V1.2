/**
 * lantmateriet-stac-import.ts
 * 
 * Mimer Bibliotekarie: Hämtar Lantmäteriets "Fastighetsindelning Nedladdning, vektor"
 * via deras nya STAC-API och lagrar enligt Mimers Brunn-policyn på H-disken.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';

const logger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string, err?: any) => console.error(`[ERROR] ${msg}`, err || '')
};

// Konfiguration
const clientId = process.env.LANTMATERIET_CLIENT_ID;
const clientSecret = process.env.LANTMATERIET_CLIENT_SECRET;
const tokenUrl = 'https://api.lantmateriet.se/token';
const stacBaseUrl = process.env.LANTMATERIET_BASE_URL || 'https://api.lantmateriet.se/stac-vektor/v1';
const scope = process.env.LANTMATERIET_SCOPE || 'stac:fastighetsindelning.read';

const H_DRIVE_ROOT = process.env.H_DRIVE_ROOT || 'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const today = new Date().toISOString().split('T')[0];
const targetDir = path.join(H_DRIVE_ROOT, 'Data', 'Lantmateriet', 'Fastighetsindelning', today);
const rawDir = path.join(targetDir, 'raw');

async function getAccessToken(): Promise<string> {
  logger.info(`Hämtar OAuth2-token med scope: ${scope}`);
  
  if (!clientId || !clientSecret) {
    throw new Error('LANTMATERIET_CLIENT_ID eller LANTMATERIET_CLIENT_SECRET saknas i .env');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token fetch failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

function downloadFile(url: string, destPath: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const options = {
      headers: {
        'Authorization': `Bearer ${token}`,
        // Lantmäteriet kan kräva specifika headers för filnedladdning
      }
    };

    https.get(url, options, (response) => {
      if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      } else if (response.statusCode === 301 || response.statusCode === 302) {
         // Följ redirects om STAC-API:et ger pre-signed S3/Blob URL:er
         https.get(response.headers.location!, (redirectRes) => {
            redirectRes.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
         }).on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
      } else {
        fs.unlink(destPath, () => {});
        reject(new Error(`Server svarade med ${response.statusCode}: ${response.statusMessage}`));
      }
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function hashFile(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

async function runStacImport() {
  logger.info('Mimer Bibliotekarie: Påbörjar nerladdning av Fastighetsindelning (STAC)...');
  
  // 1. Skapa kataloger
  if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
  }

  try {
    // 2. Autentisering
    const token = await getAccessToken();
    logger.info('Token hämtad framgångsrikt.');

    // 3. Hitta Collection och Item i STAC-API:et
    logger.info(`Söker STAC-katalog på: ${stacBaseUrl}/collections`);
    const collRes = await fetch(`${stacBaseUrl}/collections`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!collRes.ok) throw new Error(`Kunde inte hämta collections: ${collRes.statusText}`);
    const collData = await collRes.json();
    
    // Antag att vi hittar "fastighetsindelning" i collection-ID
    const collection = collData.collections.find((c: any) => c.id.toLowerCase().includes('fastighet'));
    if (!collection) {
       logger.error('Kunde inte hitta en collection för fastighetsindelning. Tillgängliga:', collData.collections.map((c:any) => c.id).join(', '));
       return;
    }
    
    logger.info(`Vald Collection: ${collection.id}. Hämtar senaste Item...`);
    const itemsRes = await fetch(`${stacBaseUrl}/collections/${collection.id}/items?limit=1`, {
       headers: { 'Authorization': `Bearer ${token}` }
    });
    const itemsData = await itemsRes.json();
    const latestItem = itemsData.features[0];
    
    if (!latestItem) throw new Error('Inga items hittades i collection');
    
    // Hitta GeoPackage (.gpkg) asset
    let downloadUrl = '';
    let assetFileName = '';
    for (const [key, asset] of Object.entries(latestItem.assets)) {
       const a = asset as any;
       if (a.href && (a.href.endsWith('.gpkg') || a.href.endsWith('.zip'))) {
          downloadUrl = a.href;
          assetFileName = path.basename(a.href);
          break;
       }
    }
    
    if (!downloadUrl) {
       // Fallback om vi inte hittar via ext, ta första asset
       const firstAsset: any = Object.values(latestItem.assets)[0];
       downloadUrl = firstAsset.href;
       assetFileName = `fastighetsindelning_${today}.gpkg`; // Gissning
    }

    // 4. Ladda ner filen
    const destPath = path.join(rawDir, assetFileName);
    logger.info(`Laddar ner asset från: ${downloadUrl}`);
    logger.info(`Sparar till: ${destPath}`);
    
    await downloadFile(downloadUrl, destPath, token);
    logger.info('Nedladdning klar!');

    // 5. Checksum och Manifest (Bundle Hashing)
    const fileHash = hashFile(destPath);
    const stats = fs.statSync(destPath);
    
    const manifest = {
      provider: "Lantmateriet",
      dataset: "Fastighetsindelning Nedladdning, vektor",
      version: latestItem.id || today,
      source_url: downloadUrl,
      downloaded_at: new Date().toISOString(),
      provenance: "stac_api",
      source_archive_sha256: fileHash,
      content_bundle_sha256: fileHash, // Eftersom GPKG är en ensam fil blir bundle och archive ofta samma (om det inte är en ZIP)
      files: [assetFileName],
      total_bytes: stats.size
    };

    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    logger.info(`Manifest skapat med hash: ${fileHash.substring(0,8)}...`);
    
    logger.info('Mimer Bibliotekarie: Harvesting-pipeline för Fastighetsindelning slutförd (Offline-First).');
    logger.info('Nästa steg: Montera /master-archive i PostGIS och kör ogr2ogr för att importera datan.');

  } catch (error) {
    logger.error('Import misslyckades', error);
  }
}

runStacImport();
