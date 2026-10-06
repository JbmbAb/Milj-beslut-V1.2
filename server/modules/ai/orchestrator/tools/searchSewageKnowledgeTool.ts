/**
 * Vertex AI Search for sewage manuals is retired.
 * There is no local replacement wired for this optional tool.
 */
export async function searchSewageKnowledgeHandler(_args: { query: string }) {
  return {
    error: 'Vertex AI Search is retired (W-NO-GOOGLE-02). No local sewage knowledge store is wired.',
  };
}
