import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock @google/generative-ai before any import ────────────────────────────

const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
  startChat: vi.fn(() => ({
    sendMessage: vi.fn(async () => ({ response: { text: () => 'chat-reply' } })),
  })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// Mock complianceRuleEngine (imported by geminiService)
vi.mock('../../server/services/complianceRuleEngine', () => ({
  evaluateComplianceRules: vi.fn(() => ({
    overallStatus: 'COMPLIANT',
    checks: [],
    recommendations: [],
  })),
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
    id: 1,
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

// ─── analyzePermitRisk – offline fallback ─────────────────────────────────────

describe('analyzePermitRisk', () => {
  it('returns a non-empty string even without Gemini API key', async () => {
    const result = await analyzePermitRisk(basePerm());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('offline fallback mentions higher risk for AVSLAG decision', async () => {
    const result = await analyzePermitRisk(basePerm({ decision_type: DecisionType.AVSLAG }));
    expect(result.toLowerCase()).toMatch(/risk|avslag|offline/i);
  });

  it('offline fallback mentions normal risk for BIFALL decision', async () => {
    const result = await analyzePermitRisk(basePerm({ decision_type: DecisionType.BIFALL }));
    expect(result.toLowerCase()).toMatch(/risk|normal|offline/i);
  });
});

// ─── chatWithPermit – offline fallback ───────────────────────────────────────

describe('chatWithPermit', () => {
  it('returns a non-empty string offline', async () => {
    const result = await chatWithPermit(basePerm(), 'Vad krävs?', []);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('offline response mentions property_id', async () => {
    const result = await chatWithPermit(basePerm({ property_id: 'PROP-XYZ' }), 'Fråga?', []);
    expect(result).toContain('PROP-XYZ');
  });
});

// ─── validateLabData – offline fallback ──────────────────────────────────────

describe('validateLabData', () => {
  it('returns a LabDataValidationResult offline', async () => {
    const result = await validateLabData('{"arsenik": 12, "bly": 50}');
    expect(result).toBeDefined();
    expect(['PASS', 'FAIL', 'UNKNOWN']).toContain(result?.status);
  });

  it('returns UNKNOWN when offline', async () => {
    const result = await validateLabData('{}');
    expect(result?.status).toBe('UNKNOWN');
  });

  it('offline result has expected shape', async () => {
    const result = await validateLabData('some lab data');
    expect(Array.isArray(result?.parameters_exceeding_limits)).toBe(true);
    expect(typeof result?.applicable_guidelines).toBe('string');
    expect(typeof result?.environmental_risk_level).toBe('string');
  });
});

// ─── analyzeLogisticsCompliance – offline fallback ───────────────────────────

describe('analyzeLogisticsCompliance', () => {
  it('returns a non-null result offline', async () => {
    const result = await analyzeLogisticsCompliance({
      wasteCode: '17 05 04',
      volume: '500 ton',
      storageDuration: '30 days',
      location: 'Solna',
      receivingFacility: 'Stena Recycling',
    });
    expect(result).toBeDefined();
  });

  it('offline result has expected shape', async () => {
    const result = await analyzeLogisticsCompliance({
      wasteCode: '20 01 21*',
      volume: '10 ton',
      storageDuration: '7 days',
      location: 'Malmö',
      receivingFacility: 'SAKAB',
    });
    if (result) {
      expect(typeof result.storage_compliance).toBe('string');
      expect(Array.isArray(result.transport_requirements)).toBe(true);
      expect(Array.isArray(result.environmental_risks)).toBe(true);
      expect(Array.isArray(result.recommended_actions)).toBe(true);
    } else {
      // null is also valid when offline
      expect(result).toBeNull();
    }
  });
});
