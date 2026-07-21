import { IBankIdProvider } from '../domain/auth';
import { IUserRepository } from '../domain/user-repository.interface';
import { InitiateBankIdAuthUseCase } from '../application/initiate-bankid-auth.usecase';
import { CollectBankIdAuthUseCase } from '../application/collect-bankid-auth.usecase';

export class AuthController {
  private initiateUseCase: InitiateBankIdAuthUseCase;
  private collectUseCase: CollectBankIdAuthUseCase;

  constructor(
    private bankIdProvider: IBankIdProvider,
    private userRepo: IUserRepository,
  ) {
    this.initiateUseCase = new InitiateBankIdAuthUseCase(bankIdProvider);
    this.collectUseCase = new CollectBankIdAuthUseCase(bankIdProvider, userRepo);
  }

  async initiateBankId(endUserIp: string, options: { personalNumber?: string } = {}) {
    return await this.initiateUseCase.execute({ endUserIp, personalNumber: options.personalNumber });
  }

  async collectBankId(orderRef: string) {
    return await this.collectUseCase.execute({ orderRef });
  }

  async cancelBankId(orderRef: string) {
    return await this.bankIdProvider.cancelAuth(orderRef);
  }
}
