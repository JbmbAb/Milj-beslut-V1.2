import { execSync } from 'child_process';

async function testVertexRest() {
  const project = 'miljointelligens';
  const location = 'europe-west1';
  const model = 'gemini-1.5-pro';
  
  console.log(`Testing Vertex AI REST with Project: ${project}, Location: ${location}`);
  
  try {
    const token = execSync('gcloud auth application-default print-access-token').toString().trim();
    
    const url = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with SUCCESS' }] }]
      })
    });
    
    const data = await response.json();
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Vertex AI REST Test Failed:', err);
  }
}

testVertexRest();
