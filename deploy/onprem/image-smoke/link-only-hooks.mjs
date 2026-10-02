// Länkar hela den statiska modulgrafen för en entry genom tsx men utvärderar
// ingen app-modul.
//
// I ESM löses och laddas varje statisk import, och varje namngiven import
// kontrolleras mot sin modul, innan någon modul utvärderas. Kroken lägger en
// grindmodul först i entry. Grinden utvärderas före allt annat i grafen och
// avslutar processen. Kommer grinden till tals är grafen alltså länkad, och
// ingen app-kod (och därmed ingen databasanslutning) har körts.
const gateUrl = new URL('./link-only-gate.mjs', import.meta.url).href;
let entryUrl = null;

export function initialize(data) {
  entryUrl = data.entryUrl;
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.split('?')[0] !== entryUrl) {
    return result;
  }
  if (result.format !== 'module') {
    throw new Error(`link-only: entry ${url} loaded as ${result.format}, expected module`);
  }
  const source =
    typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  return { ...result, source: `import ${JSON.stringify(gateUrl)};\n${source}` };
}
