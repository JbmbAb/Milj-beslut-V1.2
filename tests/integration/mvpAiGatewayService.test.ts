import { describe, it, expect, vi, beforeEach } from 'vitest';

// Denna mock måste vara helt självständig för att isolera AI-anropet
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          generateContent: async (payload: any) => {
            const prompt = payload.contents[0].parts[0].text;
            if (prompt.includes('activity_code')) {
              return {
                response: {
                  text: () =>
                    JSON.stringify({
                      requirements: [
                        { rule: 'Masshanteringskontroll', law: 'Miljöbalken', citation: '2 kap. 3 §' },
                      ],
                    }),
                },
              };
            }
            return {
              response: {
                text: () =>
                  JSON.stringify({
                    document_type: 'Miljöanmälan',
                    draft_text:
                      'Juridiska krav: Miljöbalken. Human-in-the-loop: juridisk slutgranskning kravs',
                  }),
              },
            };
          },
        };
      }
    },
  };
});

// Sätt dummy innan import för att passera init-checks
process.env.GEMINI_API_KEY = 'dummy-key-for-test';

import {
  suggestRequirementsFromGemini,
  generatePermitDraftFromGemini,
} from '../../server/services/mvpAiGatewayService';

describe('mvpAiGatewayService (Robusta tester pga Budget/Quota)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process legal requirements when AI returns valid JSON', async () => {
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
