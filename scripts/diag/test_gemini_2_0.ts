import "dotenv/config";
import { runGeminiOcr } from '../../server/services/searchService';

async function main() {
  const buf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Test) >>\nendobj');
  const res = await runGeminiOcr(buf, 'application/pdf', 'gemini-2.0-flash');
  console.log('Result:', res);
}
main();
