import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { VertexOrkester } from '../server/modules/ai/orchestrator/VertexOrkester';

async function main() {
  const projectId = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'miljointelligens';
  console.log(`Starting Vertex AI Orchestrator test on project ${projectId}...`);

  delete process.env.GEMINI_API_KEY;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\Users\\jimmy\\AppData\\Roaming\\gcloud\\application_default_credentials.json';
  
  const location = 'europe-west1';
  const orkester = new VertexOrkester(projectId, location);

  const prompt = 'Jag planerar att bygga nära vattnet vid koordinaterna Latitud 59.3293, Longitud 18.0686. Vilka jordarter finns där, och vad säger miljödomarna om strandskyddsdispens generellt?';
  
  console.log('User Prompt:', prompt);
  console.log('Waiting for AI Orchestrator to think and use tools (LegalCorpus + Geodata)...');

  try {
    const answer = await orkester.ask(prompt);
    console.log('\n--- FINAL ANSWER ---\n');
    console.log(answer);
  } catch (err: any) {
    console.error('Error during Vertex AI test:', err.message);
  }
}

main();
