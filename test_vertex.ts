import { VertexAI } from '@google-cloud/vertexai';

async function testVertex() {
  const project = process.env.VERTEX_PROJECT_ID || 'miljointelligens';
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  console.log(`Testing Vertex AI with Project: ${project}, Location: ${location}`);
  
  try {
    const vertex = new VertexAI({ project, location });
    const model = vertex.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const resp = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Reply with SUCCESS if you can hear me.' }] }],
    });
    
    const text = resp.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('Response:', text);
  } catch (err) {
    console.error('Vertex AI Test Failed:', err);
  }
}

testVertex();
