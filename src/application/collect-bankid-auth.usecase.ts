import { IBankIdProvider, AuthUser } from '../domain/auth';
import { IUserRepository } from '../domain/user-repository.interface';
import { createTokenPair } from '../../server/security/auth';

export interface CollectBankIdAuthInput {
  orderRef: string;
}

export interface CollectBankIdAuthOutput {
  status: 'pending' | 'failed' | 'complete';
  hintCode?: string;
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    role: string;
    organisationId: string;
  };
}

export class CollectBankIdAuthUseCase {
  constructor(
    private bankIdProvider: IBankIdProvider,
    private userRepo: IUserRepository,
  ) {}

  async execute(input: CollectBankIdAuthInput): Promise<CollectBankIdAuthOutput> {
    const response = await this.bankIdProvider.collectAuth(input.orderRef);

    if (response.status !== 'complete') {
      return {
        status: response.status,
        hintCode: response.hintCode,
      };
    }

    const bankidId = response.completionData?.user?.personalNumber;
    if (!bankidId) {
      throw new Error('BankID complete response missing personal number');
    }

    const user = await this.resolveAuthUser(bankidId);

    const tokens = createTokenPair(user as any); // Cast as expected type in server/security/auth

    return {
      status: 'complete',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        role: user.role,
        organisationId: user.organisationId,
      },
    };
  }

  private async resolveAuthUser(bankidId: string): Promise<AuthUser> {
    let user = await this.userRepo.findByBankId(bankidId);

    // Auto-create in mock mode if missing
    if (!user && this.bankIdProvider.getMode() === 'mock') {
      const autoCreateMock = process.env.BANKID_MOCK_AUTO_CREATE_USER !== 'false';
      if (autoCreateMock) {
        user = await this.userRepo.ensureMockUser(bankidId);
      }
    }

    if (!user) {
      throw new Error('Authenticated BankID user is not registered in a permitted organisation');
    }

    return user;
  }
}
