import 'dotenv/config';
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { generateTextWithVertex } from '../server/services/vertexAiService';

// Default coordinates (somewhere in Sweden, e.g. a point near water/infrastructure)
// If you run: npx tsx generate-lokaliseringsutredning.ts 57.7 11.9
const argLat = process.argv[2] ? parseFloat(process.argv[2]) : 58.3; 
const argLng = process.argv[3] ? parseFloat(process.argv[3]) : 13.4;

async function runInvestigation(lat: number, lng: number) {
  console.log(`\n======================================================`);
  console.log(`[1] Startar Lokaliseringsutredning för koordinat: ${lat}, ${lng}`);
  console.log(`======================================================\n`);

  const client = new Client('postgres://miljobeslut:miljobeslut@localhost:5432/miljobeslut');
  await client.connect();

  let geodataContext = '';

  try {
    console.log(`[2] Söker i Mimers Brunn (PostGIS) efter överlappande geodata inom 500m...`);
    
    // We create a WKT point from the provided lat/lng. 
    // Assuming the DB is using SWEREF99 TM (EPSG:3006), but coordinates are likely WGS84 (EPSG:4326).
    // Let's do a simple bounding box or assume WGS84 for now if not specified, 
    // or we just use ST_MakePoint and ST_Transform if the DB is 3006.
    
    // PostGIS tables are typically loaded in their native CRS (often EPSG:3006 in Sweden).
    const pointWGS84 = `ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;
    const point3006 = `ST_Transform(${pointWGS84}, 3006)`;

    // Sök i Topo10 (Höjdkurvor)
    try {
      const hojdRes = await client.query(`
        SELECT id, ST_AsText(geom) as geom 
        FROM topo_topo10_hojd_sverige 
        WHERE ST_DWithin(geom, ${point3006}, 500)
        LIMIT 5;
      `);
      if (hojdRes.rows.length > 0) {
        geodataContext += `\nTopo10 Höjdkurvor inom 500m: Hittade ${hojdRes.rows.length} höjdlinjer i direkt anslutning.\n`;
      }
    } catch (e) {
      console.log('   - Topo10 Höjdkurvor ej fullt laddade eller saknas på platsen.');
    }

    // Sök i Byggnadsverk
    try {
      const byggRes = await client.query(`
        SELECT id 
        FROM topo_topo10_byggnadsverk_sverige 
        WHERE ST_DWithin(geom, ${point3006}, 500)
        LIMIT 5;
      `);
      if (byggRes.rows.length > 0) {
        geodataContext += `Topo10 Byggnadsverk: Hittade ${byggRes.rows.length} befintliga byggnadsverk inom 500m.\n`;
      }
    } catch (e) {}

    // Sök i Nationella Värdetrakter (Naturvård)
    try {
      // Just an example table from the master import
      const natRes = await client.query(`
        SELECT id 
        FROM geo_v_rdetrakter_l1fs500trakt10 
        WHERE ST_DWithin(geom, ${point3006}, 500)
        LIMIT 1;
      `);
      if (natRes.rows.length > 0) {
        geodataContext += `Värdetrakter (Naturvård): Fastigheten/punkten överlappar ett nationellt skyddat naturområde.\n`;
      }
    } catch (e) {}

    console.log(`[3] Geodata insamlad. Skickar till Vertex AI för analys...`);
    
    if (geodataContext === '') {
      geodataContext = 'Ingen specifik geodata hittades inom 500m (eller så pågår importen fortfarande). Utgå från en generell riksbedömning baserad på koordinaten.';
    }

    const systemPrompt = `
    Du är en senior miljö- och VA-expert i Sverige som jobbar för Mimer Miljöintelligens AB.
    Du ska skriva en professionell och kärnfull Lokaliseringsutredning (fokus: Uppströmsarbete, VA, Skredrisk och Miljöpåverkan).
    
    Koordinat: Lat ${lat}, Lng ${lng}
    Rå Geodata från databasen:
    ${geodataContext}
    
    Skriv utredningen i följande format:
    1. Inledning och syfte
    2. Geografiska och geotekniska förutsättningar (tolka geodatan ovan)
    3. Analys av VA och Uppströmsarbete (använd din expertkunskap om branschen, relatera till Svenskt Vatten)
    4. Sammanfattande bedömning
    
    Ton: Extremt formell, teknisk och auktoritär. Inget säljfluff.
    `;

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) throw new Error("GEMINI_API_KEY saknas");

    const payload = {
      contents: [{ role: "user", parts: [{ text: "Generera lokaliseringsutredningen baserat på angivna systeminstruktioner." }] }],
      systemInstruction: {
        role: "system",
        parts: [{ text: systemPrompt }]
      },
      generationConfig: {
        temperature: 0.3
      }
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const json = await response.json();
    if (json.error) throw new Error(JSON.stringify(json.error));
    
    const report = json.candidates[0].content.parts[0].text;

    const outputPath = path.join(process.cwd(), 'anna_vestling_utredning.md');
    fs.writeFileSync(outputPath, report, 'utf-8');

    console.log(`[4] KLART! Utredningen är sparad till: ${outputPath}`);
    
  } catch (err) {
    console.error("Fel under utredningen:", err);
  } finally {
    await client.end();
  }
}

runInvestigation(argLat, argLng);
