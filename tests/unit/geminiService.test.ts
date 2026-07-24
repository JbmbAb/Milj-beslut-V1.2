import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock Vertex AI gateway (ersätter gamla Gemini SDK-mockar) ──────────────
vi.mock('../../server/services/vertexAiService', () => ({
  generateTextWithVertex: vi.fn(async () => ''),
  generateJsonWithVertex: vi.fn(async () => null),
  vertexConfigStatus: vi.fn(() => ({
    configured: false,
    missing: ['VERTEX_PROJECT_ID'],
    projectId: null,
    location: 'europe-west1',
  })),
  __resetVertexClientForTest: vi.fn(),
}));

// ─── Module under test ────────────────────────────────────────────────────────

// Import after mocks are in place
import {
  analyzePermitRisk,
  chatWithPermit,
  validateLabData,
  analyzeLogisticsCompliance,
  serverGenerateText,
} from '../../services/geminiService';
import { DecisionType, type Permit } from '../../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function basePerm(overrides: Partial<Permit> = {}): Permit {
  return {
    id: '1',
    filename: 'beslut.pdf',
    checksum: 'abc',
    received_date: '2025-01-01',
    property_id: 'PROP-1',
    municipality: 'Stockholm',
    waste_codes: '17 05 04',
    decision_type: DecisionType.BIFALL,
    full_text: 'Tillstånd beviljas för hantering av massor.',
    processed_at: '2025-01-02',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Ensure no API key so server client is null → offline path
  delete process.env.GEMINI_API_KEY;
  // Ensure we are in node (no window)
  vi.stubGlobal('window', undefined);
});

// ─── serverGenerateText – without API key ─────────────────────────────────────

describe('serverGenerateText', () => {
  it('returns null when GEMINI_API_KEY is not set', async () => {
    const result = await serverGenerateText('Test prompt');
    expect(result).toBeNull();
  });

  it('returns null for an empty prompt without API key', async () => {
    const result = await serverGenerateText('');
    expect(result).toBeNull();
  });
});

// ─── analyzePermitRisk – kräver live AI-källa ──────────────────────────────────
//
// OBS: Tidigare test förväntade "offline fallback" med lokala strängar.
// Den vägen är avvecklad: utan verifierad AI-källa kastar geminiService
// `unavailable(...)` enligt regeln att endast BankID får köras som demo.
describe('analyzePermitRisk', () => {
  it('kastar när ingen AI-källa finns (ingen lokal fallback)', async () => {
    await expect(analyzePermitRisk(basePerm())).rejects.toThrow(/verifierad AI-källa/);
  });

  it('kastar även för AVSLAG-beslut utan AI-källa', async () => {
    await expect(analyzePermitRisk(basePerm({ decision_type: DecisionType.AVSLAG }))).rejects.toThrow(
      /verifierad AI-källa/,
    );
  });
});

describe('chatWithPermit', () => {
  it('kastar när ingen AI-källa finns (ingen offline-generator)', async () => {
    await expect(chatWithPermit(basePerm(), 'Vad krävs?', [])).rejects.toThrow(/verifierad AI-källa/);
  });
});

describe('validateLabData', () => {
  it('kastar (eller returnerar null) när ingen AI-källa finns', async () => {
    // validateLabData kan antingen kasta eller returnera null beroende på
    // kodväg, men ska aldrig returnera en syntetisk PASS/FAIL-bedömning.
    let result: unknown = null;
    try {
      result = await validateLabData('{"arsenik": 12}');
    } catch (err) {
      expect((err as Error).message).toMatch(/verifierad AI-källa/);
      return;
    }
    expect(result).toBeNull();
  });
});

describe('analyzeLogisticsCompliance', () => {
  it('kastar eller returnerar null utan AI-källa (ingen syntetisk bedömning)', async () => {
    let result: unknown = null;
    try {
      result = await analyzeLogisticsCompliance({
        wasteCode: '17 05 04',
        volume: '500 ton',
        storageDuration: '30 days',
        location: 'Solna',
        receivingFacility: 'Stena Recycling',
      });
    } catch (err) {
      expect((err as Error).message).toMatch(/verifierad AI-källa/);
      return;
    }
    expect(result).toBeNull();
  });
});
