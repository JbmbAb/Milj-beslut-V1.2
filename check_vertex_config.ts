import { vertexConfigStatus } from './server/services/vertexAiService';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const status = vertexConfigStatus();
console.log('Vertex AI Config Status:');
console.log(JSON.stringify(status, null, 2));

console.log('Environment Variables:');
console.log('VERTEX_PROJECT_ID:', process.env.VERTEX_PROJECT_ID);
console.log('VERTEX_LOCATION:', process.env.VERTEX_LOCATION);
console.log('GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET');
console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
