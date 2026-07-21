import { GoogleGenAI } from '@google/genai';
const location = 'europe-west1';
const projectId = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'miljointelligens';
const ai = new GoogleGenAI({ vertexai: true, project: projectId, location });

async function testModel(modelName: string) {
  try {
    const chat = ai.chats.create({ model: modelName });
    await chat.sendMessage({ message: 'Hej' });
    console.log(`[SUCCESS] ${modelName} works in ${location}`);
  } catch (e: any) {
    console.log(`[FAIL] ${modelName}: ${e.message}`);
  }
}

async function run() {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = 'C:\\Users\\jimmy\\AppData\\Roaming\\gcloud\\application_default_credentials.json';
  await testModel('gemini-1.5-pro');
  await testModel('gemini-1.5-pro-001');
  await testModel('gemini-1.5-flash');
  await testModel('gemini-1.5-flash-001');
}
run();
