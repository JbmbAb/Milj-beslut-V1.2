/**
 * Browser-build stub: Vertex AI-orkestrering körs enbart på servern.
 * Klienten anropar /api/… istället för att bundla verktyg + PostGIS + RAG.
 */

export class VertexOrkester {
  constructor(_projectId: string, _location?: string, _model?: string) {}

  async ask(_prompt: string): Promise<string> {
    throw new Error('VertexOrkester får endast anropas från serverprocessen, inte från Vite-klientbundlen.');
  }
}
