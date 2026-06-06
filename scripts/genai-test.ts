import { GoogleGenAI } from '@google/genai';

async function main() {
  const ai = new GoogleGenAI({
    vertexai: { project: process.env.VERTEX_PROJECT_ID || 'miljointelligens', location: process.env.VERTEX_LOCATION || 'europe-west1' }
  });

  const chat = ai.chats.create({
    model: 'gemini-1.5-pro',
    config: {
      systemInstruction: "You are a helpful assistant",
      tools: [
        {
          functionDeclarations: [
            {
              name: "get_weather",
              description: "Get the weather",
              parameters: {
                type: "OBJECT",
                properties: {
                  location: { type: "STRING" }
                }
              }
            }
          ]
        }
      ]
    }
  });

  const res = await chat.sendMessage({ message: "What is the weather in Stockholm?" });
  console.dir(res, { depth: null });
}

main().catch(console.error);
