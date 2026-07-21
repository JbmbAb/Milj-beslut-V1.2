import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/security/auth', () => ({
  createTokenPair: vi.fn(() => ({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
  })),
}));

import { CollectBankIdAuthUseCase } from '../../src/application/collect-bankid-auth.usecase';
import { ComputeComplianceProfileUseCase } from '../../src/application/compute-compliance-profile.usecase';
import { InitiateBankIdAuthUseCase } from '../../src/application/initiate-bankid-auth.usecase';
import { ComplianceCategory, ComplianceStatus, RatingLabel } from '../../src/domain/compliance';

describe('src application auth and compliance use cases', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('initiates BankID auth and generates animated QR payload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-03T10:00:00.000Z'));

    const bankIdProvider = {
      initiateAuth: vi.fn().mockResolvedValue({
        orderRef: 'order-1',
        autoStartToken: 'auto-1',
        qrStartToken: 'qr-token',
        qrStartSecret: 'qr-secret',
      }),
    };

    const useCase = new InitiateBankIdAuthUseCase(bankIdProvider as any);
    const result = await useCase.execute({ endUserIp: '127.0.0.1' });

    expect(bankIdProvider.initiateAuth).toHaveBeenCalledWith('127.0.0.1', {
      personalNumber: undefined,
    });
    expect(result.orderTime).toBe('2026-04-03T10:00:00.000Z');
    expect(result.qrPayload).toMatch(/^bankid\.qr-token\.0\.[a-f0-9]{64}$/);
  });

  it('returns pending collect response unchanged', async () => {
    const bankIdProvider = {
      collectAuth: vi.fn().mockResolvedValue({
        orderRef: 'order-1',
        status: 'pending',
        hintCode: 'outstandingTransaction',
      }),
      getMode: vi.fn().mockReturnValue('real'),
    };
    const userRepo = {
      findByBankId: vi.fn(),
      ensureMockUser: vi.fn(),
    };

    const useCase = new CollectBankIdAuthUseCase(bankIdProvider as any, userRepo as any);
    await expect(useCase.execute({ orderRef: 'order-1' })).resolves.toEqual({
      status: 'pending',
      hintCode: 'outstandingTransaction',
    });
    expect(userRepo.findByBankId).not.toHaveBeenCalled();
  });

  it('creates tokens for a registered BankID user', async () => {
    const bankIdProvider = {
      collectAuth: vi.fn().mockResolvedValue({
        orderRef: 'order-1',
        status: 'complete',
        completionData: {
          user: {
            personalNumber: '191212121212',
            givenName: 'Ada',
            surname: 'Lovelace',
            name: 'Ada Lovelace',
          },
        },
      }),
      getMode: vi.fn().mockReturnValue('real'),
    };
    const userRepo = {
      findByBankId: vi.fn().mockResolvedValue({
        id: 'user-1',
        role: 'ADMIN',
        organisationId: 'org-1',
        bankidId: '191212121212',
      }),
      ensureMockUser: vi.fn(),
    };

    const useCase = new CollectBankIdAuthUseCase(bankIdProvider as any, userRepo as any);
    await expect(useCase.execute({ orderRef: 'order-1' })).resolves.toEqual({
      status: 'complete',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {
        id: 'user-1',
        role: 'ADMIN',
        organisationId: 'org-1',
      },
    });
  });

  it('auto-creates mock users when BankID mock mode allows it', async () => {
    const bankIdProvider = {
      collectAuth: vi.fn().mockResolvedValue({
        orderRef: 'order-1',
        status: 'complete',
        completionData: {
          user: {
            personalNumber: '191212121212',
            givenName: 'Ada',
            surname: 'Lovelace',
            name: 'Ada Lovelace',
          },
        },
      }),
      getMode: vi.fn().mockReturnValue('mock'),
    };
    const userRepo = {
      findByBankId: vi.fn().mockResolvedValue(null),
      ensureMockUser: vi.fn().mockResolvedValue({
        id: 'user-2',
        role: 'CONSULTANT',
        organisationId: 'org-2',
        bankidId: '191212121212',
      }),
    };

    const useCase = new CollectBankIdAuthUseCase(bankIdProvider as any, userRepo as any);
    const result = await useCase.execute({ orderRef: 'order-1' });

    expect(userRepo.ensureMockUser).toHaveBeenCalledWith('191212121212');
    expect(result.user).toEqual({
      id: 'user-2',
      role: 'CONSULTANT',
      organisationId: 'org-2',
    });
  });

  it('throws when a complete BankID response lacks a personal number', async () => {
    const bankIdProvider = {
      collectAuth: vi.fn().mockResolvedValue({
        orderRef: 'order-1',
        status: 'complete',
        completionData: { user: { personalNumber: '' } },
      }),
      getMode: vi.fn().mockReturnValue('real'),
    };
    const userRepo = {
      findByBankId: vi.fn(),
      ensureMockUser: vi.fn(),
    };

    const useCase = new CollectBankIdAuthUseCase(bankIdProvider as any, userRepo as any);
    await expect(useCase.execute({ orderRef: 'order-1' })).rejects.toThrow(
      'BankID complete response missing personal number',
    );
  });

  it('computes and persists a compliance profile', async () => {
    const indicators = [
      {
        id: 'ENV_PERMIT',
        category: ComplianceCategory.ENVIRONMENTAL,
        name: 'Miljötillstånd',
        description: 'Tillstånd finns',
        maxScore: 40,
      },
      {
        id: 'GOV_REQUIREMENTS',
        category: ComplianceCategory.GOVERNANCE,
        name: 'Verifierade krav',
        description: 'Kravspårning',
        maxScore: 60,
      },
    ];

    const complianceRepo = {
      getAllIndicators: vi.fn().mockResolvedValue(indicators),
      saveProfile: vi.fn(async (profile) => profile),
    };
    const projectRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'project-1',
        name: 'Projekt Alfa',
        status: 'ACTIVE',
      }),
    };
    const requirementRepo = {
      findByProject: vi
        .fn()
        .mockResolvedValue([{ status: 'VERIFIED' }, { status: 'VERIFIED' }, { status: 'PENDING' }]),
    };
    const auditRepo = {
      findByEntity: vi.fn().mockResolvedValue([{ id: 'audit-1' }]),
    };

    const useCase = new ComputeComplianceProfileUseCase(
      complianceRepo as any,
      projectRepo as any,
      requirementRepo as any,
      auditRepo as any,
    );
    const result = await useCase.execute({ projectId: 'project-1' });

    expect(result.projectId).toBe('project-1');
    expect(result.overallScore).toBe(80);
    expect(result.ratingLabel).toBe(RatingLabel.GOOD);
    expect(result.indicators).toHaveLength(2);
    expect(result.criticalGaps).toEqual([]);
    expect(complianceRepo.saveProfile).toHaveBeenCalledOnce();
  });

  it('fails compliance computation for missing projects', async () => {
    const useCase = new ComputeComplianceProfileUseCase(
      {
        getAllIndicators: vi.fn(),
        saveProfile: vi.fn(),
      } as any,
      {
        findById: vi.fn().mockResolvedValue(null),
      } as any,
      {
        findByProject: vi.fn(),
      } as any,
      {
        findByEntity: vi.fn(),
      } as any,
    );

    await expect(useCase.execute({ projectId: 'missing-project' })).rejects.toThrow('Project not found');
  });

  it('marks failed indicators as critical gaps', async () => {
    const complianceRepo = {
      getAllIndicators: vi.fn().mockResolvedValue([
        {
          id: 'ENV_PERMIT',
          category: ComplianceCategory.ENVIRONMENTAL,
          name: 'Miljötillstånd',
          description: 'Tillstånd finns',
          maxScore: 50,
        },
        {
          id: 'GOV_REQUIREMENTS',
          category: ComplianceCategory.GOVERNANCE,
          name: 'Verifierade krav',
          description: 'Kravspårning',
          maxScore: 50,
        },
      ]),
      saveProfile: vi.fn(async (profile) => profile),
    };
    const projectRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'project-2',
        name: 'Projekt Beta',
        status: 'DRAFT',
      }),
    };
    const requirementRepo = {
      findByProject: vi.fn().mockResolvedValue([]),
    };
    const auditRepo = {
      findByEntity: vi.fn().mockResolvedValue([]),
    };

    const useCase = new ComputeComplianceProfileUseCase(
      complianceRepo as any,
      projectRepo as any,
      requirementRepo as any,
      auditRepo as any,
    );
    const result = await useCase.execute({ projectId: 'project-2' });

    expect(result.ratingLabel).toBe(RatingLabel.FAILING);
    expect(result.indicators.some((indicator) => indicator.status === ComplianceStatus.FAIL)).toBe(true);
    expect(result.criticalGaps).toContain('Miljötillstånd: No permit found');
  });
});
