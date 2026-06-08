import { GoogleGenAI } from '@google/genai';
import { searchLegalCorpusDeclaration, searchLegalCorpusHandler } from './tools/searchLegalCorpusTool';
import { queryGeodataDeclaration, queryGeodataHandler } from './tools/queryGeodataTool';
import { searchSewageKnowledgeDeclaration, searchSewageKnowledgeHandler } from './tools/searchSewageKnowledgeTool';
import { DEFAULT_AI_POLICY, ragSystemInstruction } from '../policy';
import { logger } from '../../../logger';

type ToolHandler = (args: unknown) => Promise<unknown>;

export class VertexOrkester {
  private ai: GoogleGenAI;
  private tools: Array<{ functionDeclarations: unknown[] }>;
  private toolHandlers: Record<string, ToolHandler>;
  private model: string;

  constructor(projectId: string, location?: string, model: string = 'gemini-1.5-pro') {
    const loc = location || process.env.VERTEX_LOCATION || 'europe-west1';
    this.ai = new GoogleGenAI({ vertexai: true, project: projectId, location: loc });
    this.model = process.env.VERTEX_MODEL || model;
    this.toolHandlers = {
      searchLegalCorpus: (args) =>
        searchLegalCorpusHandler(args as Parameters<typeof searchLegalCorpusHandler>[0]),
      queryGeodata: (args) => queryGeodataHandler(args as Parameters<typeof queryGeodataHandler>[0]),
      searchSewageKnowledge: (args) =>
        searchSewageKnowledgeHandler(args as Parameters<typeof searchSewageKnowledgeHandler>[0]),
    };

    this.tools = [
      {
        functionDeclarations: [
          searchLegalCorpusDeclaration,
          queryGeodataDeclaration,
          searchSewageKnowledgeDeclaration
        ]
      }
    ];
  }

  private async invokeTool(name: string, args: unknown): Promise<unknown> {
    const handler = this.toolHandlers[name];
    if (!handler) {
      throw new Error(`Unknown function ${name}`);
    }
    return handler(args);
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
          const args = call.args ?? {};
          let apiResponse: unknown;

          try {
            apiResponse = await this.invokeTool(name, args);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn('VertexOrkester tool invocation failed', { name, message });
            apiResponse = { error: `Verktygsfel: ${message}` };
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
      logger.warn('VertexOrkester loop cap reached', { maxLoops: MAX_LOOPS });
    }

    return response.text || 'Kunde inte generera ett svar.';
  }
}
