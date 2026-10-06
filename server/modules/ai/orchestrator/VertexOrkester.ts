const RETIRED = 'Vertex runtime is retired (W-NO-GOOGLE-02).';

/** Fail-closed stub. The class is not a Google client and does not call a network. */
export class VertexOrkester {
  constructor(_projectId: string, _location?: string, _model?: string) {
    throw new Error(RETIRED);
  }

  public async ask(_prompt: string): Promise<string> {
    throw new Error(RETIRED);
  }
}
