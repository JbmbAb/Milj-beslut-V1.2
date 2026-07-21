import { getLantmaterietAccessToken } from '../server/services/lantmaterietService';
import dotenv from 'dotenv';

dotenv.config();

async function discoverOgc() {
  try {
    const token = await getLantmaterietAccessToken();
    console.log('Token fetched successfully.');

    const endpoints = [
      'https://api.lantmateriet.se/ogc-features/v1/fastighetsindelning',
      'https://api.lantmateriet.se/ogc-features/v1/topografi',
      'https://api.lantmateriet.se/ogc-features/v1/topografi10',
      'https://api.lantmateriet.se/ogc-features/v1/topografi50',
      'https://api.lantmateriet.se/ogc-features/v1/topografiska-kartor',
      'https://api.lantmateriet.se/distribution/produkter/topografi/v1/ogc/features',
    ];

    for (const base of endpoints) {
      console.log(`\nTesting base: ${base}`);
      const url = `${base}/collections`;
      try {
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        });
        console.log(`Status: ${res.status}`);
        if (res.ok) {
          const data = await res.json();
          console.log(`Collections found:`, (data.collections || []).map((c: any) => c.id).join(', '));
        } else {
          // const text = await res.text();
          // console.log(`Error: ${text.slice(0, 100)}`);
        }
      } catch (e) {
        console.log(`Fetch error: ${e}`);
      }
    }
  } catch (err) {
    console.error('Discovery failed:', err);
  }
}

discoverOgc();
