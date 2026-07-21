import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import {
  submitSewageApplicationToMunicipality,
  getMunicipalityContactEmail,
  getMunicipalityEstimatedProcessingDays,
} from '../../../server/services/municipalitySubmissionService';
import { prisma } from '../../../db.server';

vi.mock('../../../db.server', () => ({
  prisma: {
    submission: {
      upsert: vi.fn(),
      update: vi.fn(),
    },
    submissionStatusEvent: {
      create: vi.fn(),
    },
    submissionArtifact: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../../../server/modules/evidence/public', () => ({
  createCaseSnapshot: vi.fn(),
  exportFromSnapshot: vi.fn(),
  resolveRequirementCaseIdForSubmission: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../server/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const baseApp: any = {
  id: 'app-1',
  projectId: 'proj-1',
  propertyDesignation: 'TEST 1:1',
  pe: 5,
  selectedSystemType: 'CLOSED_TANK',
};

const baseProfile: any = { protectionLevel: 'NORMAL' };

function mockPrismaOk() {
  (prisma.submission.upsert as any).mockResolvedValue({ id: 'sub-1', submissionKey: 'key' });
  (prisma.submissionStatusEvent.create as any).mockResolvedValue({ id: 'evt-1' });
  (prisma.submissionArtifact.create as any).mockResolvedValue({ id: 'art-1' });
}

describe('MunicipalitySubmissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaOk();
    delete process.env.MUNICIPALITY_API_KEY_0180;
    delete process.env.MUNICIPALITY_API_KEY_1280;
  });

  afterEach(() => {
    delete process.env.MUNICIPALITY_API_KEY_0180;
    delete process.env.MUNICIPALITY_API_KEY_1280;
  });

  it('EMAIL channel (Uppsala 3100): submits and persists records', async () => {
    const result = await submitSewageApplicationToMunicipality(
      baseApp,
      baseProfile,
      '3100', // Uppsala (EMAIL)
      '<svg>plan</svg>',
      '<svg>section</svg>',
      'test@example.com',
      'proj-1',
      'org-1',
    );

    expect(result.ok).toBe(true);
    expect(result.integrationType).toBe('EMAIL');
    expect(prisma.submission.upsert).toHaveBeenCalled();
    expect(prisma.submissionStatusEvent.create).toHaveBeenCalled();
    expect(prisma.submissionArtifact.create).toHaveBeenCalledTimes(2);
  });

  it('REST channel (Stockholm 0180): calls fetch with API key', async () => {
    process.env.MUNICIPALITY_API_KEY_0180 = 'sthlm-key';
    fetchMock.mockResolvedValueOnce({ ok: true });

    const result = await submitSewageApplicationToMunicipality(
      baseApp,
      baseProfile,
      '0180',
      '<svg>plan</svg>',
      '<svg>section</svg>',
      'sthlm@example.com',
      'proj-1',
      'org-1',
    );

    expect(result.ok).toBe(true);
    expect(result.integrationType).toBe('REST');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('stockholm'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('REST channel throws when API key is missing', async () => {
    // No MUNICIPALITY_API_KEY_0180 set
    await expect(
      submitSewageApplicationToMunicipality(
        baseApp,
        baseProfile,
        '0180',
        '<svg>plan</svg>',
        '<svg>section</svg>',
        'test@example.com',
        'proj-1',
        'org-1',
      ),
    ).rejects.toThrow(/Missing API key for municipality 0180/);
  });

  it('unknown municipality code falls back to email and returns ok', async () => {
    const result = await submitSewageApplicationToMunicipality(
      baseApp,
      baseProfile,
      '9999', // unknown code
      '<svg>plan</svg>',
      '<svg>section</svg>',
      'unknown@example.com',
      'proj-1',
      'org-1',
    );

    expect(result.ok).toBe(true);
    expect(result.integrationType).toBe('EMAIL');
    expect(result.municipalityCode).toBe('9999');
  });

  it('KÖ channel (Västerås 0184) falls through to email', async () => {
    const result = await submitSewageApplicationToMunicipality(
      baseApp,
      baseProfile,
      '0184', // Västerås (KÖ → falls back to email internally)
      '<svg>plan</svg>',
      '<svg>section</svg>',
      'vasteras@example.com',
      'proj-1',
      'org-1',
    );

    expect(result.ok).toBe(true);
    expect(result.integrationType).toBe('KÖ');
  });
});

describe('getMunicipalityContactEmail', () => {
  it('returns known municipality emails', () => {
    expect(getMunicipalityContactEmail('0180')).toBe('miljoe@stockholm.se');
    expect(getMunicipalityContactEmail('1280')).toBe('miljoe@malmo.se');
    expect(getMunicipalityContactEmail('3100')).toBe('miljoe@uppsala.se');
  });

  it('returns fallback email for unknown code', () => {
    expect(getMunicipalityContactEmail('9999')).toBe('miljoe@kommun.se');
  });
});

describe('getMunicipalityEstimatedProcessingDays', () => {
  it('returns known municipality processing days', () => {
    expect(getMunicipalityEstimatedProcessingDays('0180')).toBe(30);
    expect(getMunicipalityEstimatedProcessingDays('0184')).toBe(28);
    expect(getMunicipalityEstimatedProcessingDays('0580')).toBe(35);
  });

  it('returns default 30 days for unknown code', () => {
    expect(getMunicipalityEstimatedProcessingDays('9999')).toBe(30);
  });
});
