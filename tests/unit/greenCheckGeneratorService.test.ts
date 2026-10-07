import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('../../server/modules/ai/generation/LocalGenerationPort', () => ({
  generateText: vi.fn((prompt: string, opts?: unknown) => mockGenerateContent(prompt, opts)),
  generateJson: vi.fn(async () => null),
  isLocalGenerationAvailable: vi.fn(() => true),
  localGenerationStatus: vi.fn(() => ({ available: true, runtime_id: 'test', model_id: 'test', blocker: null })),
}));

vi.mock('../../db.server', () => ({
  prisma: {
    project: { findUnique: vi.fn() },
  },
}));

import { generateGreenCheck } from '../../server/services/greenCheckGeneratorService';
import type { GreenCheckRequest } from '../../server/services/greenCheckGeneratorService';
import { SecureError } from '../../server/security/secureErrors';

const baseRequest: GreenCheckRequest = {
  organizationNumber: '556700-0000',
  organizationName: 'Testbolaget AB',
  projectDescription: 'Installation av solceller på industritak i Gävle',
  investmentAmount: 2_000_000,
  sector: 'renewable_energy',
  latitude: 60.67,
  longitude: 17.14,
};

/**
 * HD-14 (A9 sweep, 2026-09-29). This function used to send one Gemini prompt and then default any
 * field the model omitted to a specific, plausible-looking value — including the headline ESG
 * letter rating (`rating: 'BBB'`) — and always attach a fixed "externalSourcesUsed" list naming
 * Finansinspektionen/Naturvårdsverket/EU Taxonomy Registry etc. regardless of whether the single
 * Gemini prompt actually consulted any of them (it never did). These tests replace the old ones,
 * which fed the mock a complete JSON response and asserted the fabricated defaulting/sourceTracking
 * behaviour as if it were correct — they never exercised the omitted-field path at all. The route
 * behind this (LEGACY_FLAG, off by default) is unaffected here; only the service is tested.
 */
describe('generateGreenCheck (HD-14: no fabricated ESG rating or source list)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses with an explicit, typed error instead of generating an assessment', async () => {
    await expect(generateGreenCheck(baseRequest)).rejects.toMatchObject({
      name: 'SecureError',
      statusCode: 501,
      code: 'GREEN_CHECK_NOT_IMPLEMENTED',
    });
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('never calls Vertex at all, so no prompt can be sent on a bank\'s behalf', async () => {
    mockGenerateContent.mockResolvedValue('{"esgRating":{"rating":"A"}}');
    await expect(generateGreenCheck(baseRequest)).rejects.toBeInstanceOf(SecureError);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('refuses regardless of which fields the request supplies', async () => {
    const minimal: GreenCheckRequest = { organizationNumber: '556700-1111', projectDescription: 'Ny fabrik' };
    await expect(generateGreenCheck(minimal)).rejects.toBeInstanceOf(SecureError);
  });
});
