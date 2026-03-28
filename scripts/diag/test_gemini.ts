import { runGeminiOcr } from '../../server/services/searchService';

async function main() {
  const buf = Buffer.from('Test document content');
  const res = await runGeminiOcr(buf, 'text/plain', 'gemini-1.5-flash');
  console.log('Result:', res);
}
main();
