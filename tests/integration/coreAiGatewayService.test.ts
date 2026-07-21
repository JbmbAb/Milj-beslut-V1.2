import { describe, it, expect, vi, beforeEach } from 'vitest';

// Denna mock ersätter Vertex-gatewayen (tidigare Gemini direct SDK).
// Mocket skickar prompten vidare till en simulerad "Vertex" och väljer
// svar baserat på vad som efterfrågas.
vi.mock('../../server/services/vertexAiService', () => {
  return {
    generateJsonWithVertex: async (prompt: string, opts: any) => {
      if (prompt.includes('activity_code')) {
        return opts?.parse?.({
          requirements: [{ rule: 'Masshanteringskontroll', law: 'Miljöbalken', citation: '2 kap. 3 §' }],
        });
      }
      return opts?.parse?.({
        document_type: 'Miljöanmälan',
        draft_text: 'Juridiska krav: Miljöbalken. Human-in-the-loop: juridisk slutgranskning kravs',
      });
    },
    generateTextWithVertex: vi.fn(async () => ''),
    vertexConfigStatus: vi.fn(() => ({
      configured: true,
      missing: [],
      projectId: 'test',
      location: 'europe-west1',
    })),
    __resetVertexClientForTest: vi.fn(),
  };
});

// Sätt dummy VERTEX_PROJECT_ID innan import (krävs av config-check).
process.env.VERTEX_PROJECT_ID = 'dummy-project-for-test';

import {
  suggestRequirementsFromGemini,
  generatePermitDraftFromGemini,
} from '../../server/services/coreAiGatewayService';

describe('coreAiGatewayService (Vertex-integrationstest)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process legal requirements when Vertex returns valid JSON', async () => {
    const input = { activityCode: '91.10', ewcCode: '17 05 04' };
    const requirements = await suggestRequirementsFromGemini(input);

    expect(requirements).toBeDefined();
    expect(requirements![0].law).toBe('Miljöbalken');
  });

  it('should properly generate a permit draft', async () => {
    const input = {
      projectData: {},
      requirements: [],
      riskFlags: [],
      defaultDocumentType: 'Anmälan',
    };

    const draft = await generatePermitDraftFromGemini(input);

    expect(draft!.document_type).toBe('Miljöanmälan');
    expect(draft!.draft_text).toContain('Human-in-the-loop');
  });
});
