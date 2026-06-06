import { GoogleGenAI } from '@google/genai';
import { searchLegalCorpusDeclaration, searchLegalCorpusHandler } from './tools/searchLegalCorpusTool';
import { queryGeodataDeclaration, queryGeodataHandler } from './tools/queryGeodataTool';
import { DEFAULT_AI_POLICY, ragSystemInstruction } from '../policy';

export class VertexOrkester {
  private ai: GoogleGenAI;
  private tools: any[];
  private model: string;

  constructor(projectId: string, location?: string, model: string = 'gemini-1.5-pro') {
    const loc = location || process.env.VERTEX_LOCATION || 'europe-west1';
    this.ai = new GoogleGenAI({ vertexai: { project: projectId, location: loc }, project: projectId, location: loc });
    this.model = process.env.VERTEX_MODEL || model;

    this.tools = [
      {
        functionDeclarations: [
          searchLegalCorpusDeclaration,
          queryGeodataDeclaration
        ]
      }
    ];
  }

  public async ask(prompt: string): Promise<string> {
    const chat = this.ai.chats.create({
      model: this.model,
      config: {
        systemInstruction: ragSystemInstruction(DEFAULT_AI_POLICY),
        tools: this.tools,
      }
    });

    let response = await chat.sendMessage({ message: prompt });
    
    // Check if the model decided to call a function
    let functionCalls = response.functionCalls;

    let loopCount = 0;
    const MAX_LOOPS = 4;

    while (functionCalls && functionCalls.length > 0 && loopCount < MAX_LOOPS) {
      loopCount++;

      const parts = await Promise.all(
        functionCalls.map(async (call) => {
          const name = call.name;
          const args = call.args as any;
          let apiResponse: any;

          try {
            if (name === 'searchLegalCorpus') {
              apiResponse = await searchLegalCorpusHandler(args);
            } else if (name === 'queryGeodata') {
              apiResponse = await queryGeodataHandler(args);
            } else {
              apiResponse = { error: `Unknown function ${name}` };
            }
          } catch (err: any) {
            apiResponse = { error: `Verktygsfel: ${err.message}` };
          }

          return {
            functionResponse: {
              name,
              response: apiResponse
            }
          };
        })
      );

      // Send the function response back to the model
      response = await chat.sendMessage({
        message: parts
      });
      functionCalls = response.functionCalls;
    }

    if (functionCalls && functionCalls.length > 0 && loopCount >= MAX_LOOPS) {
      console.warn(`VertexOrkester: loopCount reached MAX_LOOPS (${MAX_LOOPS}) while model still requested tool calls.`);
    }

    return response.text || 'Kunde inte generera ett svar.';
  }
}
